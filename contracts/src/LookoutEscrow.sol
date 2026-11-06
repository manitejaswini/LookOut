// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title LookoutEscrow
/// @notice Holds report deposits, the bounty pool and reviewer stakes for Lookout.
///
/// Arkiv entities (`stake`) mirror this contract's state. THIS contract is the source of truth for money.
///
/// Trust model, stated plainly:
///  - One address, `resolver`, decides whether a report is confirmed or rejected and which reviewers are slashed. In the
///    demo that is the panel service's wallet, which is seeded by the team. It is a single key, so it can be wrong or
///    compromised. What it CANNOT do: take anyone's deposit for itself (forfeits go to the bounty pool, never to the
///    resolver), pay a bounty twice, or touch a reviewer's stake beyond slashing it into the pool.
///  - If the resolver never decides, the reporter can reclaim their deposit after `resolveWindow`.
///  - Reviewers can always withdraw after `unstakeDelay`. The delay must be longer than a case lasts, so a juror cannot
///    leave before they can be slashed.
contract LookoutEscrow {
    /* ------------------------------ configuration ----------------------------- */

    address public immutable resolver;
    /// @notice the exact deposit every report locks
    uint256 public immutable depositWei;
    /// @notice what one confirmed report is paid out of the pool
    uint256 public immutable bountyWei;
    /// @notice the stake a reviewer needs to be eligible
    uint256 public immutable minReviewerStake;
    uint64 public immutable unstakeDelay;
    uint64 public immutable resolveWindow;

    /* ---------------------------------- state --------------------------------- */

    enum Status { None, Locked, Returned, Slashed, Reclaimed }

    struct Deposit {
        address reporter;
        Status status;
        uint64 lockedAt;
        bool bountyPaid;
    }

    /// @dev keyed by depositKey(reporter, reportId), so nobody can squat another reporter's report id
    mapping(bytes32 => Deposit) public deposits;

    struct Stake {
        uint128 amount;
        uint64 unlockAt; // 0 means not unstaking
    }

    mapping(address => Stake) public stakes;
    mapping(address => uint256) public claimable;

    uint256 public bountyPool;
    uint256 public totalLocked;
    uint256 public totalStaked;
    uint256 public totalClaimable;

    uint256 private _lock = 1;

    /* --------------------------------- events --------------------------------- */

    event Deposited(bytes32 indexed key, address indexed reporter, bytes16 reportId, uint256 amount);
    event Confirmed(bytes32 indexed key, address indexed reporter, bytes16 reportId);
    event Rejected(bytes32 indexed key, address indexed reporter, bytes16 reportId, uint256 forfeited);
    event Reclaimed(bytes32 indexed key, address indexed reporter, bytes16 reportId);
    event Claimed(address indexed to, uint256 amount);
    event BountyPaid(bytes32 indexed key, address indexed stealth, uint256 amount);
    event PoolFunded(address indexed from, uint256 amount);
    event Staked(address indexed reviewer, uint256 added, uint256 total);
    event UnstakeRequested(address indexed reviewer, uint64 unlockAt);
    event Withdrawn(address indexed reviewer, uint256 amount);
    event Slashed(address indexed reviewer, uint256 taken);

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
    error BelowMinimum();
    error NotUnstaking();
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

    constructor(address resolver_, uint256 depositWei_, uint256 bountyWei_, uint256 minReviewerStake_, uint64 unstakeDelay_, uint64 resolveWindow_) {
        if (resolver_ == address(0)) revert ZeroAddress();
        if (depositWei_ == 0 || resolveWindow_ == 0) revert BadConfig();
        resolver = resolver_;
        depositWei = depositWei_;
        bountyWei = bountyWei_;
        minReviewerStake = minReviewerStake_;
        unstakeDelay = unstakeDelay_;
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
        deposits[key] = Deposit({reporter: msg.sender, status: Status.Locked, lockedAt: uint64(block.timestamp), bountyPaid: false});
        totalLocked += msg.value;
        emit Deposited(key, msg.sender, reportId, msg.value);
    }

    /// @notice The report was confirmed: the deposit becomes claimable by the reporter. A bounty can then be paid.
    function confirm(address reporter, bytes16 reportId) external onlyResolver {
        (bytes32 key, Deposit storage d) = _locked(reporter, reportId);
        d.status = Status.Returned;
        totalLocked -= depositWei;
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

    /// @notice Pay the bounty for a CONFIRMED report to a one-time stealth address, once. The payment comes out of the pool.
    function payBounty(address reporter, bytes16 reportId, address payable stealth) external nonReentrant onlyResolver {
        if (stealth == address(0)) revert ZeroAddress();
        bytes32 key = depositKey(reporter, reportId);
        Deposit storage d = deposits[key];
        if (d.status != Status.Returned) revert NotConfirmed();
        if (d.bountyPaid) revert AlreadyPaid();
        if (bountyPool < bountyWei) revert PoolTooSmall();
        d.bountyPaid = true;
        bountyPool -= bountyWei;
        emit BountyPaid(key, stealth, bountyWei);
        _send(stealth, bountyWei);
    }

    /* ------------------------------ reviewer stakes ---------------------------- */

    /// @notice Stake to become eligible as a reviewer. Staking again adds to the stake and cancels a pending unstake.
    function stake() external payable {
        Stake storage s = stakes[msg.sender];
        uint256 total = uint256(s.amount) + msg.value;
        if (total < minReviewerStake || total == 0) revert BelowMinimum();
        if (total > type(uint128).max) revert WrongAmount();
        // total was just checked to be at most type(uint128).max
        // forge-lint: disable-next-line(unsafe-typecast)
        s.amount = uint128(total);
        s.unlockAt = 0;
        totalStaked += msg.value;
        emit Staked(msg.sender, msg.value, total);
    }

    /// @notice Start the unstake clock. The stake stays slashable until it is withdrawn.
    function requestUnstake() external {
        Stake storage s = stakes[msg.sender];
        if (s.amount == 0) revert BelowMinimum();
        if (s.unlockAt == 0) {
            // a block timestamp fits in 64 bits for the next 500 billion years
            // forge-lint: disable-next-line(unsafe-typecast)
            s.unlockAt = uint64(block.timestamp) + unstakeDelay;
            emit UnstakeRequested(msg.sender, s.unlockAt);
        }
    }

    function withdraw() external nonReentrant {
        Stake storage s = stakes[msg.sender];
        if (s.unlockAt == 0) revert NotUnstaking();
        // the delay is days; a validator can only skew a timestamp by seconds
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < s.unlockAt) revert TooEarly();
        uint256 amount = s.amount;
        s.amount = 0;
        s.unlockAt = 0;
        totalStaked -= amount;
        emit Withdrawn(msg.sender, amount);
        if (amount > 0) _send(msg.sender, amount);
    }

    /// @notice Slash a reviewer who voted on the losing side, or did not reveal. Capped at their stake, and it goes to the pool.
    function slash(address reviewer, uint256 amount) external onlyResolver {
        Stake storage s = stakes[reviewer];
        uint256 taken = amount < s.amount ? amount : s.amount;
        // taken is at most s.amount, which is a uint128
        // forge-lint: disable-next-line(unsafe-typecast)
        s.amount -= uint128(taken);
        totalStaked -= taken;
        bountyPool += taken;
        emit Slashed(reviewer, taken);
    }

    function isEligibleReviewer(address who) external view returns (bool) {
        Stake storage s = stakes[who];
        return s.amount >= minReviewerStake && s.amount > 0 && s.unlockAt == 0;
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
        // Recipients: the caller itself (claim, withdraw) or the resolver's chosen stealth address (payBounty).
        // forge-lint: disable-next-line(arbitrary-send-eth, reentrancy-eth)
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
