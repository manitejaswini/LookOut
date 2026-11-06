// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {LookoutEscrow} from "../src/LookoutEscrow.sol";

// The Foundry cheatcodes this suite uses. Declared here so the project needs no external library.
interface Vm {
    function deal(address who, uint256 newBalance) external;
    function prank(address caller) external;
    function startPrank(address caller) external;
    function stopPrank() external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes4 selector) external;
}

/// A reporter or reviewer that tries to re-enter the escrow when it is paid, and SWALLOWS the failure so the outer payment still goes through.
contract Reenterer {
    LookoutEscrow public immutable escrow;
    uint256 public entered;
    bool public innerSucceeded;

    constructor(LookoutEscrow e) { escrow = e; }

    receive() external payable {
        entered++;
        // try to take the same money twice
        try escrow.claim() { innerSucceeded = true; } catch {}
        try escrow.withdraw() { innerSucceeded = true; } catch {}
    }

    function doDeposit(bytes16 id) external payable { escrow.deposit{value: msg.value}(id); }
    function doClaim() external { escrow.claim(); }
    function doStake() external payable { escrow.stake{value: msg.value}(); }
    function doRequestUnstake() external { escrow.requestUnstake(); }
    function doWithdraw() external { escrow.withdraw(); }
}

/// An address that refuses ETH, like a contract with no receive function.
contract RefusesEth {
    receive() external payable { revert("no thanks"); }
}

/// A resolver that is also the recipient and tries to call payBounty again from inside the payment.
contract ReenteringResolver {
    LookoutEscrow public escrow;
    address public reporter;
    bytes16 public reportId;

    function set(LookoutEscrow e, address r, bytes16 id) external { escrow = e; reporter = r; reportId = id; }
    function pay(address payable stealth) external { escrow.payBounty(reporter, reportId, stealth); }
    receive() external payable { escrow.payBounty(reporter, reportId, payable(address(this))); }
}

contract LookoutEscrowTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 constant DEPOSIT = 0.01 ether;
    uint256 constant BOUNTY = 0.005 ether;
    uint256 constant MIN_STAKE = 1 ether;
    uint64 constant UNSTAKE_DELAY = 7 days;
    uint64 constant WINDOW = 30 days;

    address constant RESOLVER = address(0xBEEF);
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    address constant CAROL = address(0xCA201);
    address constant STEALTH = address(0x57EA17);
    address constant ATTACKER = address(0xBAD);

    bytes16 constant ID1 = bytes16(0x0123456789abcdef0123456789abcdef);
    bytes16 constant ID2 = bytes16(0xfedcba9876543210fedcba9876543210);

    LookoutEscrow escrow;

    receive() external payable {}

    function setUp() public {
        escrow = new LookoutEscrow(RESOLVER, DEPOSIT, BOUNTY, MIN_STAKE, UNSTAKE_DELAY, WINDOW);
        vm.deal(ALICE, 100 ether);
        vm.deal(BOB, 100 ether);
        vm.deal(CAROL, 100 ether);
        vm.deal(RESOLVER, 1 ether);
    }

    /* ----------------------------- tiny assertions ---------------------------- */

    function eq(uint256 a, uint256 b, string memory what) internal pure { require(a == b, what); }
    function yes(bool c, string memory what) internal pure { require(c, what); }

    function status(address reporter, bytes16 id) internal view returns (LookoutEscrow.Status s) {
        (, s, , ) = escrow.deposits(escrow.depositKey(reporter, id));
    }

    function bountyPaid(address reporter, bytes16 id) internal view returns (bool paid) {
        (, , , paid) = escrow.deposits(escrow.depositKey(reporter, id));
    }

    function deposit(address who, bytes16 id) internal {
        vm.prank(who);
        escrow.deposit{value: DEPOSIT}(id);
    }

    function solvent() internal view {
        eq(address(escrow).balance, escrow.totalLocked() + escrow.totalStaked() + escrow.bountyPool() + escrow.totalClaimable(), "solvency");
    }

    /* -------------------------------- deposits -------------------------------- */

    function test_depositLocksExactlyTheDeposit() public {
        deposit(ALICE, ID1);
        yes(status(ALICE, ID1) == LookoutEscrow.Status.Locked, "locked");
        eq(escrow.totalLocked(), DEPOSIT, "totalLocked");
        eq(address(escrow).balance, DEPOSIT, "balance");
        solvent();
    }

    function testFuzz_depositWithAnyOtherAmountReverts(uint256 amount) public {
        if (amount == DEPOSIT || amount > 50 ether) return;
        vm.prank(ALICE);
        vm.expectRevert(LookoutEscrow.WrongAmount.selector);
        escrow.deposit{value: amount}(ID1);
    }

    function test_theSameReportCannotBeDepositedTwice() public {
        deposit(ALICE, ID1);
        vm.prank(ALICE);
        vm.expectRevert(LookoutEscrow.AlreadyExists.selector);
        escrow.deposit{value: DEPOSIT}(ID1);
    }

    function test_nobodyCanSquatAnotherReportersId() public {
        // an attacker who sees ALICE's pending id and front-runs it with the same id only gets their OWN deposit
        vm.deal(ATTACKER, 1 ether);
        deposit(ATTACKER, ID1);
        deposit(ALICE, ID1);
        yes(status(ALICE, ID1) == LookoutEscrow.Status.Locked, "alice is not blocked");
        yes(status(ATTACKER, ID1) == LookoutEscrow.Status.Locked, "attacker holds their own");
        eq(escrow.totalLocked(), 2 * DEPOSIT, "both locked");
        solvent();
    }

    /* ------------------------------- resolution ------------------------------- */

    function test_confirmMakesTheDepositClaimableAndClaimPaysOnce() public {
        deposit(ALICE, ID1);
        vm.prank(RESOLVER);
        escrow.confirm(ALICE, ID1);
        yes(status(ALICE, ID1) == LookoutEscrow.Status.Returned, "returned");
        eq(escrow.claimable(ALICE), DEPOSIT, "claimable");
        eq(escrow.totalLocked(), 0, "no longer locked");
        solvent();

        uint256 before = ALICE.balance;
        vm.prank(ALICE);
        escrow.claim();
        eq(ALICE.balance, before + DEPOSIT, "paid");
        eq(address(escrow).balance, 0, "escrow empty");
        solvent();

        vm.prank(ALICE);
        vm.expectRevert(LookoutEscrow.NothingToClaim.selector);
        escrow.claim();
    }

    function test_rejectForfeitsTheDepositToThePoolAndTheResolverGetsNothing() public {
        deposit(ALICE, ID1);
        uint256 resolverBefore = RESOLVER.balance;
        vm.prank(RESOLVER);
        escrow.reject(ALICE, ID1);
        yes(status(ALICE, ID1) == LookoutEscrow.Status.Slashed, "slashed");
        eq(escrow.bountyPool(), DEPOSIT, "pool grew");
        eq(escrow.claimable(ALICE), 0, "reporter gets nothing back");
        eq(RESOLVER.balance, resolverBefore, "the resolver is not paid");
        eq(escrow.claimable(RESOLVER), 0, "nor credited");
        solvent();
    }

    function test_onlyTheResolverCanResolve() public {
        deposit(ALICE, ID1);
        vm.prank(ATTACKER);
        vm.expectRevert(LookoutEscrow.NotResolver.selector);
        escrow.confirm(ALICE, ID1);
        vm.prank(ALICE); // not even the reporter
        vm.expectRevert(LookoutEscrow.NotResolver.selector);
        escrow.reject(ALICE, ID1);
        vm.prank(ATTACKER);
        vm.expectRevert(LookoutEscrow.NotResolver.selector);
        escrow.slash(ALICE, 1);
        vm.prank(ATTACKER);
        vm.expectRevert(LookoutEscrow.NotResolver.selector);
        escrow.payBounty(ALICE, ID1, payable(ATTACKER));
    }

    function test_aDepositResolvesOnceOnly() public {
        deposit(ALICE, ID1);
        vm.startPrank(RESOLVER);
        escrow.confirm(ALICE, ID1);
        vm.expectRevert(LookoutEscrow.NotLocked.selector);
        escrow.confirm(ALICE, ID1);
        vm.expectRevert(LookoutEscrow.NotLocked.selector);
        escrow.reject(ALICE, ID1);
        vm.stopPrank();

        deposit(ALICE, ID2);
        vm.startPrank(RESOLVER);
        escrow.reject(ALICE, ID2);
        vm.expectRevert(LookoutEscrow.NotLocked.selector);
        escrow.confirm(ALICE, ID2);
        vm.stopPrank();
    }

    function test_aDepositThatNeverHappenedCannotBeResolved() public {
        vm.startPrank(RESOLVER);
        vm.expectRevert(LookoutEscrow.NotLocked.selector);
        escrow.confirm(ALICE, ID1);
        vm.expectRevert(LookoutEscrow.NotLocked.selector);
        escrow.reject(ALICE, ID1);
        vm.stopPrank();
    }

    /* --------------------------------- bounty --------------------------------- */

    function fundPool() internal {
        // a rejected deposit is what normally funds the pool
        deposit(CAROL, ID2);
        vm.prank(RESOLVER);
        escrow.reject(CAROL, ID2);
    }

    function test_bountyIsPaidToTheStealthAddressOnceForAConfirmedReport() public {
        fundPool();
        deposit(ALICE, ID1);
        vm.startPrank(RESOLVER);
        escrow.confirm(ALICE, ID1);
        escrow.payBounty(ALICE, ID1, payable(STEALTH));
        vm.stopPrank();
        eq(STEALTH.balance, BOUNTY, "stealth address received the bounty");
        eq(escrow.bountyPool(), DEPOSIT - BOUNTY, "pool paid it");
        yes(bountyPaid(ALICE, ID1), "marked paid");
        solvent();

        vm.prank(RESOLVER);
        vm.expectRevert(LookoutEscrow.AlreadyPaid.selector);
        escrow.payBounty(ALICE, ID1, payable(STEALTH));
        eq(STEALTH.balance, BOUNTY, "still only one payment");
    }

    function test_noBountyForALockedRejectedOrUnknownReport() public {
        fundPool();
        deposit(ALICE, ID1);
        vm.startPrank(RESOLVER);
        vm.expectRevert(LookoutEscrow.NotConfirmed.selector);
        escrow.payBounty(ALICE, ID1, payable(STEALTH)); // still locked
        escrow.reject(ALICE, ID1);
        vm.expectRevert(LookoutEscrow.NotConfirmed.selector);
        escrow.payBounty(ALICE, ID1, payable(STEALTH)); // rejected
        vm.expectRevert(LookoutEscrow.NotConfirmed.selector);
        escrow.payBounty(BOB, ID1, payable(STEALTH)); // never existed
        vm.stopPrank();
        eq(STEALTH.balance, 0, "nothing paid");
    }

    function test_theBountyNeedsAFundedPoolAndTheResolverCannotMintMoney() public {
        deposit(ALICE, ID1);
        vm.startPrank(RESOLVER);
        escrow.confirm(ALICE, ID1);
        vm.expectRevert(LookoutEscrow.PoolTooSmall.selector);
        escrow.payBounty(ALICE, ID1, payable(STEALTH));
        vm.stopPrank();
        // the reporter's own refund is untouched by the empty pool
        eq(escrow.claimable(ALICE), DEPOSIT, "refund intact");
        // a plain transfer funds the pool, and then the bounty can be paid
        (bool ok, ) = address(escrow).call{value: BOUNTY}("");
        yes(ok, "plain transfer accepted");
        eq(escrow.bountyPool(), BOUNTY, "pool funded");
        vm.prank(RESOLVER);
        escrow.payBounty(ALICE, ID1, payable(STEALTH));
        eq(STEALTH.balance, BOUNTY, "paid");
        solvent();
    }

    function test_theBountyCannotGoToTheZeroAddress() public {
        fundPool();
        deposit(ALICE, ID1);
        vm.startPrank(RESOLVER);
        escrow.confirm(ALICE, ID1);
        vm.expectRevert(LookoutEscrow.ZeroAddress.selector);
        escrow.payBounty(ALICE, ID1, payable(address(0)));
        vm.stopPrank();
    }

    function test_aRecipientThatRefusesEthDoesNotLoseTheBountyAndTheResolverCanRetry() public {
        fundPool();
        deposit(ALICE, ID1);
        RefusesEth bad = new RefusesEth();
        vm.startPrank(RESOLVER);
        escrow.confirm(ALICE, ID1);
        vm.expectRevert(LookoutEscrow.TransferFailed.selector);
        escrow.payBounty(ALICE, ID1, payable(address(bad)));
        vm.stopPrank();
        yes(!bountyPaid(ALICE, ID1), "state rolled back: not marked paid");
        eq(escrow.bountyPool(), DEPOSIT, "pool untouched");
        vm.prank(RESOLVER);
        escrow.payBounty(ALICE, ID1, payable(STEALTH));
        eq(STEALTH.balance, BOUNTY, "retry to a good address works");
    }

    function test_aRefundCannotBeBlockedByAReporterThatRefusesEth() public {
        // the refund is pulled, so a hostile reporter only hurts themselves and the resolver is never stuck
        RefusesEth bad = new RefusesEth();
        vm.deal(address(bad), 1 ether);
        vm.prank(address(bad));
        escrow.deposit{value: DEPOSIT}(ID1);
        vm.prank(RESOLVER);
        escrow.confirm(address(bad), ID1); // the resolver is NOT blocked
        eq(escrow.claimable(address(bad)), DEPOSIT, "owed, claimable when they can receive");
        solvent();
    }

    function test_aRecipientThatReentersPayBountyIsStopped() public {
        fundPool();
        ReenteringResolver r = new ReenteringResolver();
        LookoutEscrow e2 = new LookoutEscrow(address(r), DEPOSIT, BOUNTY, MIN_STAKE, UNSTAKE_DELAY, WINDOW);
        vm.deal(ALICE, 10 ether);
        vm.prank(ALICE);
        e2.deposit{value: DEPOSIT}(ID1);
        vm.prank(CAROL);
        e2.deposit{value: DEPOSIT}(ID2);
        // reject CAROL to fund e2's pool, confirm ALICE, then pay the bounty to the resolver contract itself
        r.set(e2, ALICE, ID1);
        vm.startPrank(address(r));
        e2.reject(CAROL, ID2);
        e2.confirm(ALICE, ID1);
        vm.stopPrank();
        vm.expectRevert(LookoutEscrow.TransferFailed.selector); // the inner call hit the guard, so the payment as a whole fails
        r.pay(payable(address(r)));
        eq(e2.bountyPool(), DEPOSIT, "nothing left the pool");
    }

    /* --------------------------------- reclaim -------------------------------- */

    function test_theReporterCanReclaimOnlyAfterTheWindow() public {
        deposit(ALICE, ID1);
        vm.warp(block.timestamp + WINDOW - 1);
        vm.prank(ALICE);
        vm.expectRevert(LookoutEscrow.TooEarly.selector);
        escrow.reclaim(ID1);

        vm.warp(block.timestamp + 1);
        vm.prank(ALICE);
        escrow.reclaim(ID1);
        yes(status(ALICE, ID1) == LookoutEscrow.Status.Reclaimed, "reclaimed");
        eq(escrow.claimable(ALICE), DEPOSIT, "refund claimable");
        solvent();
    }

    function test_afterAReclaimTheResolverCannotDecideAndNoBountyIsPossible() public {
        fundPool();
        deposit(ALICE, ID1);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(ALICE);
        escrow.reclaim(ID1);
        vm.startPrank(RESOLVER);
        vm.expectRevert(LookoutEscrow.NotLocked.selector);
        escrow.confirm(ALICE, ID1);
        vm.expectRevert(LookoutEscrow.NotLocked.selector);
        escrow.reject(ALICE, ID1);
        vm.expectRevert(LookoutEscrow.NotConfirmed.selector);
        escrow.payBounty(ALICE, ID1, payable(STEALTH));
        vm.stopPrank();
    }

    function test_onlyTheDepositorCanReclaimItAndOnlyOnce() public {
        deposit(ALICE, ID1);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(BOB);
        vm.expectRevert(LookoutEscrow.NotLocked.selector);
        escrow.reclaim(ID1); // Bob has no deposit under this id
        vm.prank(ALICE);
        escrow.reclaim(ID1);
        vm.prank(ALICE);
        vm.expectRevert(LookoutEscrow.NotLocked.selector);
        escrow.reclaim(ID1);
    }

    function test_aResolvedDepositCannotBeReclaimed() public {
        deposit(ALICE, ID1);
        vm.prank(RESOLVER);
        escrow.confirm(ALICE, ID1);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(ALICE);
        vm.expectRevert(LookoutEscrow.NotLocked.selector);
        escrow.reclaim(ID1);
    }

    /* ------------------------------- re-entrancy ------------------------------ */

    function test_claimCannotBeReenteredToTakeTheMoneyTwice() public {
        Reenterer r = new Reenterer(escrow);
        vm.deal(address(this), 10 ether);
        r.doDeposit{value: DEPOSIT}(ID1);
        deposit(ALICE, ID2); // other people's money sits in the escrow too
        vm.prank(RESOLVER);
        escrow.confirm(address(r), ID1);
        r.doClaim();
        eq(address(r).balance, DEPOSIT, "paid exactly once");
        yes(r.entered() == 1, "the payment did call back");
        yes(!r.innerSucceeded(), "the re-entry failed");
        eq(address(escrow).balance, DEPOSIT, "Alice's deposit is still all there");
        solvent();
    }

    function test_withdrawCannotBeReenteredToTakeTheStakeTwice() public {
        Reenterer r = new Reenterer(escrow);
        vm.deal(address(this), 10 ether);
        r.doStake{value: MIN_STAKE}();
        deposit(ALICE, ID2);
        r.doRequestUnstake();
        vm.warp(block.timestamp + UNSTAKE_DELAY);
        r.doWithdraw();
        eq(address(r).balance, MIN_STAKE, "paid exactly once");
        yes(!r.innerSucceeded(), "the re-entry failed");
        eq(address(escrow).balance, DEPOSIT, "other money untouched");
        solvent();
    }

    /* ---------------------------------- staking ------------------------------- */

    function stakeAs(address who, uint256 amount) internal {
        vm.prank(who);
        escrow.stake{value: amount}();
    }

    function test_aReviewerNeedsTheMinimumStake() public {
        vm.prank(BOB);
        vm.expectRevert(LookoutEscrow.BelowMinimum.selector);
        escrow.stake{value: MIN_STAKE - 1}();
        yes(!escrow.isEligibleReviewer(BOB), "not eligible");
        stakeAs(BOB, MIN_STAKE);
        yes(escrow.isEligibleReviewer(BOB), "eligible");
        eq(escrow.totalStaked(), MIN_STAKE, "totalStaked");
        solvent();
    }

    function test_topUpsAdd() public {
        stakeAs(BOB, MIN_STAKE);
        stakeAs(BOB, 0.5 ether);
        (uint128 amount, ) = escrow.stakes(BOB);
        eq(amount, MIN_STAKE + 0.5 ether, "added");
        solvent();
    }

    function test_unstakeNeedsTheDelayAndThenReturnsTheStake() public {
        stakeAs(BOB, 2 ether);
        vm.prank(BOB);
        vm.expectRevert(LookoutEscrow.NotUnstaking.selector);
        escrow.withdraw(); // never asked to unstake

        vm.prank(BOB);
        escrow.requestUnstake();
        yes(!escrow.isEligibleReviewer(BOB), "an unstaking reviewer is not drawn for new cases");
        vm.warp(block.timestamp + UNSTAKE_DELAY - 1);
        vm.prank(BOB);
        vm.expectRevert(LookoutEscrow.TooEarly.selector);
        escrow.withdraw();

        vm.warp(block.timestamp + 1);
        uint256 before = BOB.balance;
        vm.prank(BOB);
        escrow.withdraw();
        eq(BOB.balance, before + 2 ether, "stake returned");
        eq(escrow.totalStaked(), 0, "nothing staked");
        solvent();
    }

    function test_askingToUnstakeAgainDoesNotRestartTheClock() public {
        stakeAs(BOB, MIN_STAKE);
        vm.prank(BOB);
        escrow.requestUnstake();
        (, uint64 first) = escrow.stakes(BOB);
        vm.warp(block.timestamp + 3 days);
        vm.prank(BOB);
        escrow.requestUnstake();
        (, uint64 second) = escrow.stakes(BOB);
        eq(second, first, "unchanged");
    }

    function test_stakingAgainCancelsAPendingUnstake() public {
        stakeAs(BOB, MIN_STAKE);
        vm.prank(BOB);
        escrow.requestUnstake();
        stakeAs(BOB, 0.1 ether);
        (, uint64 unlockAt) = escrow.stakes(BOB);
        eq(unlockAt, 0, "cancelled");
        yes(escrow.isEligibleReviewer(BOB), "eligible again");
    }

    function test_slashMovesTheStakeIntoThePoolCappedAtWhatIsStaked() public {
        stakeAs(BOB, 2 ether);
        vm.prank(RESOLVER);
        escrow.slash(BOB, 0.5 ether);
        (uint128 left, ) = escrow.stakes(BOB);
        eq(left, 1.5 ether, "reduced");
        eq(escrow.bountyPool(), 0.5 ether, "into the pool, not to the resolver");
        vm.prank(RESOLVER);
        escrow.slash(BOB, 100 ether); // more than they have
        (left, ) = escrow.stakes(BOB);
        eq(left, 0, "emptied, not underflowed");
        eq(escrow.bountyPool(), 2 ether, "exactly what they had");
        solvent();
    }

    function test_slashingSomeoneWithNoStakeTakesNothingAndDoesNotRevert() public {
        vm.prank(RESOLVER);
        escrow.slash(ATTACKER, 1 ether);
        eq(escrow.bountyPool(), 0, "nothing");
    }

    function test_aReviewerCannotEscapeASlashByUnstaking() public {
        stakeAs(BOB, 2 ether);
        vm.prank(BOB);
        escrow.requestUnstake();
        vm.prank(RESOLVER);
        escrow.slash(BOB, 1 ether); // still slashable while the clock runs
        vm.warp(block.timestamp + UNSTAKE_DELAY);
        uint256 before = BOB.balance;
        vm.prank(BOB);
        escrow.withdraw();
        eq(BOB.balance, before + 1 ether, "only the remainder comes back");
        solvent();
    }

    /* -------------------------------- the pool -------------------------------- */

    function test_aPlainTransferGoesToThePoolSoNoEthIsUnaccounted() public {
        (bool ok, ) = address(escrow).call{value: 1 ether}("");
        yes(ok, "accepted");
        eq(escrow.bountyPool(), 1 ether, "in the pool");
        solvent();
    }

    /* ---------------------------------- config -------------------------------- */

    function test_theConstructorRefusesNonsense() public {
        vm.expectRevert(LookoutEscrow.ZeroAddress.selector);
        new LookoutEscrow(address(0), DEPOSIT, BOUNTY, MIN_STAKE, UNSTAKE_DELAY, WINDOW);
        vm.expectRevert(LookoutEscrow.BadConfig.selector);
        new LookoutEscrow(RESOLVER, 0, BOUNTY, MIN_STAKE, UNSTAKE_DELAY, WINDOW);
        vm.expectRevert(LookoutEscrow.BadConfig.selector);
        new LookoutEscrow(RESOLVER, DEPOSIT, BOUNTY, MIN_STAKE, UNSTAKE_DELAY, 0);
    }

    /* ---------------------------- solvency, fuzzed ---------------------------- */

    /// Whatever sequence of operations happens, the escrow always holds EXACTLY what it owes:
    /// locked deposits + reviewer stakes + the bounty pool + refunds waiting to be claimed.
    function testFuzz_theEscrowIsAlwaysExactlySolvent(uint256 seed) public {
        address[4] memory people = [ALICE, BOB, CAROL, address(0xD00D)];
        vm.deal(address(0xD00D), 100 ether);
        for (uint256 i = 0; i < 60; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            address who = people[seed % 4];
            bytes16 id = bytes16(uint128(seed >> 8) % 6);
            uint256 op = (seed >> 32) % 11;

            if (op == 0) { vm.prank(who); try escrow.deposit{value: DEPOSIT}(id) {} catch {} }
            else if (op == 1) { vm.prank(RESOLVER); try escrow.confirm(who, id) {} catch {} }
            else if (op == 2) { vm.prank(RESOLVER); try escrow.reject(who, id) {} catch {} }
            else if (op == 3) { vm.prank(who); try escrow.claim() {} catch {} }
            else if (op == 4) { vm.prank(who); try escrow.reclaim(id) {} catch {} }
            else if (op == 5) { vm.prank(RESOLVER); try escrow.payBounty(who, id, payable(STEALTH)) {} catch {} }
            else if (op == 6) { vm.prank(who); try escrow.stake{value: MIN_STAKE + (seed >> 40) % 3 ether}() {} catch {} }
            else if (op == 7) { vm.prank(who); try escrow.requestUnstake() {} catch {} }
            else if (op == 8) { vm.prank(who); try escrow.withdraw() {} catch {} }
            else if (op == 9) { vm.prank(RESOLVER); try escrow.slash(who, (seed >> 40) % 2 ether) {} catch {} }
            else { vm.warp(block.timestamp + ((seed >> 40) % 20 days)); }

            solvent();
        }
    }
}
