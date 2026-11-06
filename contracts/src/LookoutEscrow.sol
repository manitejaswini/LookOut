// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title LookoutEscrow
/// @notice Holds report deposits and the bounty pool for Lookout.
///
/// Arkiv entities (`stake`) mirror this contract's state. THIS contract is the source of truth for money.
///
/// Trust model, stated plainly:
///  - One address, `resolver`, settles every report: `confirm` (a trusted source corroborated it: deposit back, and a bounty may
///    follow), `refund` (it added nothing new or was not corroborated in time: deposit back, NO bounty) or `reject` (the
///    operator rules it false: the deposit is forfeited). It is a single key, so it can be wrong or compromised. What it
///    CANNOT do: take anyone's deposit for itself (forfeits go to the bounty pool, never to the resolver), pay a bounty twice,
///    or pay more bounties than there were confirmed reports.
///  - If the resolver never decides, the reporter can reclaim their deposit after `resolveWindow`.
contract LookoutEscrow {
    /* ------------------------------ configuration ----------------------------- */

    address public immutable resolver;
    /// @notice the exact deposit every report locks
    uint256 public immutable depositWei;
    /// @notice what one confirmed report is paid out of the pool
    uint256 public immutable bountyWei;
    uint64 public immutable resolveWindow;

    /* ---------------------------------- state --------------------------------- */

    enum Status { None, Locked, Returned, Slashed, Reclaimed, Refunded }

    struct Deposit {
        address reporter;
        Status status;
        uint64 lockedAt;
    }

    /// @dev keyed by depositKey(reporter, reportId), so nobody can squat another reporter's report id
    mapping(bytes32 => Deposit) public deposits;

    mapping(address => uint256) public claimable;

    /// @notice bounties already paid, by an OPAQUE id the resolver derives from a secret. The id is deliberately not
    /// the deposit key: if it were, anyone could compute it from a public report and link the stealth address to the reporter.
    mapping(bytes32 => bool) public bountyPaid;
    /// @notice how many reports were confirmed, and how many bounties were paid. A bounty can never be paid unless a
    /// confirmation is still unrewarded, so the resolver cannot pay more bounties than there were confirmed reports.
    uint256 public confirmedCount;
    uint256 public bountiesPaid;

    uint256 public bountyPool;
    uint256 public totalLocked;
    uint256 public totalClaimable;

    uint256 private _lock = 1;

    /* --------------------------------- events --------------------------------- */

    event Deposited(bytes32 indexed key, address indexed reporter, bytes16 reportId, uint256 amount);
    event Confirmed(bytes32 indexed key, address indexed reporter, bytes16 reportId);
    event Rejected(bytes32 indexed key, address indexed reporter, bytes16 reportId, uint256 forfeited);
    event Reclaimed(bytes32 indexed key, address indexed reporter, bytes16 reportId);
    event Refunded(bytes32 indexed key, address indexed reporter, bytes16 reportId);
    event Claimed(address indexed to, uint256 amount);
    event BountyPaid(address indexed stealth, uint256 amount);
    event PoolFunded(address indexed from, uint256 amount);

    /* --------------------------------- errors --------------------------------- */

    error NotResolver();
    error Reentrant();
    error WrongAmount();
    error AlreadyExists();
    error NotLocked();
    error TooEarly();
    error NothingToClaim();
    error NotConfirmed();
    error AlreadyPaid();
    error PoolTooSmall();
    error ZeroAddress();
    error TransferFailed();
    error BadConfig();

    /* ------------------------------- modifiers -------------------------------- */

    modifier onlyResolver() {
        if (msg.sender != resolver) revert NotResolver();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrant();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address resolver_, uint256 depositWei_, uint256 bountyWei_, uint64 resolveWindow_) {
        if (resolver_ == address(0)) revert ZeroAddress();
        if (depositWei_ == 0 || resolveWindow_ == 0) revert BadConfig();
        resolver = resolver_;
        depositWei = depositWei_;
        bountyWei = bountyWei_;
        resolveWindow = resolveWindow_;
    }

    /* ------------------------------- the pool --------------------------------- */

    /// @notice Anyone may add to the bounty pool. Plain transfers go here too, so no ETH is ever unaccounted for.
    receive() external payable {
        bountyPool += msg.value;
        emit PoolFunded(msg.sender, msg.value);
    }

    /* ------------------------------ report deposits ---------------------------- */

    function depositKey(address reporter, bytes16 reportId) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(reporter, reportId));
    }

    /// @notice Lock the deposit for a report. `reportId` is the 128-bit id the reporter's client generated for the Arkiv report.
    function deposit(bytes16 reportId) external payable {
        if (msg.value != depositWei) revert WrongAmount();
        bytes32 key = depositKey(msg.sender, reportId);
        if (deposits[key].status != Status.None) revert AlreadyExists();
        // a block timestamp fits in 64 bits for the next 500 billion years
        // forge-lint: disable-next-line(unsafe-typecast)
        deposits[key] = Deposit({reporter: msg.sender, status: Status.Locked, lockedAt: uint64(block.timestamp)});
        totalLocked += msg.value;
        emit Deposited(key, msg.sender, reportId, msg.value);
    }

    /// @notice The report was confirmed: the deposit becomes claimable by the reporter. A bounty can then be paid.
    function confirm(address reporter, bytes16 reportId) external onlyResolver {
        (bytes32 key, Deposit storage d) = _locked(reporter, reportId);
        d.status = Status.Returned;
        totalLocked -= depositWei;
        confirmedCount += 1;
        _credit(reporter, depositWei);
        emit Confirmed(key, reporter, reportId);
    }

    /// @notice The report was rejected: the deposit is forfeited to the bounty pool. The resolver gets nothing.
    function reject(address reporter, bytes16 reportId) external onlyResolver {
        (bytes32 key, Deposit storage d) = _locked(reporter, reportId);
        d.status = Status.Slashed;
        totalLocked -= depositWei;
        bountyPool += depositWei;
        emit Rejected(key, reporter, reportId, depositWei);
    }

    /// @notice The report added nothing new, or no trusted source corroborated it in time: the deposit goes back with NO bounty.
    /// This is not a confirmation, so it does not count towards the bounties the resolver may pay.
    function refund(address reporter, bytes16 reportId) external onlyResolver {
        (bytes32 key, Deposit storage d) = _locked(reporter, reportId);
        d.status = Status.Refunded;
        totalLocked -= depositWei;
        _credit(reporter, depositWei);
        emit Refunded(key, reporter, reportId);
    }

    /// @notice If the resolver has not decided within `resolveWindow`, the reporter takes their deposit back. No bounty.
    function reclaim(bytes16 reportId) external {
        bytes32 key = depositKey(msg.sender, reportId);
        Deposit storage d = deposits[key];
        if (d.status != Status.Locked) revert NotLocked();
        // the window is days; a validator can only skew a timestamp by seconds
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < uint256(d.lockedAt) + resolveWindow) revert TooEarly();
        d.status = Status.Reclaimed;
        totalLocked -= depositWei;
        _credit(msg.sender, depositWei);
        emit Reclaimed(key, msg.sender, reportId);
    }

    /// @notice Withdraw whatever this address is owed (refunded deposits). Pulled, so nobody can block settlement by refusing ETH.
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        totalClaimable -= amount;
        emit Claimed(msg.sender, amount);
        _send(msg.sender, amount);
    }

    /// @notice Pay one bounty from the pool to a one-time stealth address.
    ///
    /// PRIVACY: this takes NO reporter and NO report id, and its event names only the stealth address. Everything an
    /// observer can see on chain is "the pool paid some address", not "this reporter's report was rewarded". Which report
    /// a bounty belongs to is known only to the resolver, which derives `bountyId` from a secret (so it cannot be recomputed
    /// from public data). What stays visible: the amount, the time, and that it follows a confirmation. With few reports,
    /// timing alone can still hint at the link, so this hides the link from casual analysis and not from a determined observer.
    ///
    /// LIMITS on the resolver, since it no longer names a report here: one payment per `bountyId`, never more payments than
    /// confirmed reports, and never more than the pool holds. It still chooses WHO is paid, which is the trust it already has.
    function payBounty(bytes32 bountyId, address payable stealth) external nonReentrant onlyResolver {
        if (stealth == address(0)) revert ZeroAddress();
        if (bountyPaid[bountyId]) revert AlreadyPaid();
        if (bountiesPaid >= confirmedCount) revert NotConfirmed();
        if (bountyPool < bountyWei) revert PoolTooSmall();
        bountyPaid[bountyId] = true;
        bountiesPaid += 1;
        bountyPool -= bountyWei;
        emit BountyPaid(stealth, bountyWei);
        _send(stealth, bountyWei);
    }

    /* -------------------------------- internals -------------------------------- */

    function _locked(address reporter, bytes16 reportId) private view returns (bytes32 key, Deposit storage d) {
        key = depositKey(reporter, reportId);
        d = deposits[key];
        if (d.status != Status.Locked) revert NotLocked();
    }

    function _credit(address to, uint256 amount) private {
        claimable[to] += amount;
        totalClaimable += amount;
    }

    function _send(address to, uint256 amount) private {
        // every caller is guarded by nonReentrant, and updates all state and emits its event BEFORE calling this.
        // Recipients: the caller itself (claim) or the resolver's chosen stealth address (payBounty).
        // forge-lint: disable-next-line(arbitrary-send-eth, reentrancy-eth)
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
