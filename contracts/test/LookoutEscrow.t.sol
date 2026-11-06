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
    }

    function doDeposit(bytes16 id) external payable { escrow.deposit{value: msg.value}(id); }
    function doClaim() external { escrow.claim(); }
}

/// An address that refuses ETH, like a contract with no receive function.
contract RefusesEth {
    receive() external payable { revert("no thanks"); }
}

contract LookoutEscrowTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 constant DEPOSIT = 0.01 ether;
    uint256 constant BOUNTY = 0.005 ether;
    uint64 constant WINDOW = 30 days;

    address constant RESOLVER = address(0xBEEF);
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    address constant CAROL = address(0xCA201);
    address constant ATTACKER = address(0xBAD);

    bytes16 constant ID1 = bytes16(0x0123456789abcdef0123456789abcdef);
    bytes16 constant ID2 = bytes16(0xfedcba9876543210fedcba9876543210);

    LookoutEscrow escrow;

    receive() external payable {}

    function setUp() public {
        escrow = new LookoutEscrow(RESOLVER, DEPOSIT, BOUNTY, WINDOW);
        vm.deal(ALICE, 100 ether);
        vm.deal(BOB, 100 ether);
        vm.deal(CAROL, 100 ether);
        vm.deal(RESOLVER, 1 ether);
    }

    /* ----------------------------- tiny assertions ---------------------------- */

    function eq(uint256 a, uint256 b, string memory what) internal pure { require(a == b, what); }
    function yes(bool c, string memory what) internal pure { require(c, what); }

    function status(address reporter, bytes16 id) internal view returns (LookoutEscrow.Status s) {
        (, s, ) = escrow.deposits(escrow.depositKey(reporter, id));
    }

    function deposit(address who, bytes16 id) internal {
        vm.prank(who);
        escrow.deposit{value: DEPOSIT}(id);
    }

    function solvent() internal view {
        eq(address(escrow).balance, escrow.totalLocked() + escrow.bountyPool() + escrow.totalClaimable(), "solvency");
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
        escrow.confirm(ALICE, ID1, false);
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
        escrow.confirm(ALICE, ID1, false);
        vm.prank(ALICE); // not even the reporter
        vm.expectRevert(LookoutEscrow.NotResolver.selector);
        escrow.reject(ALICE, ID1);
        vm.prank(ATTACKER);
        vm.expectRevert(LookoutEscrow.NotResolver.selector);
        escrow.refund(ALICE, ID1);
    }

    function test_aDepositResolvesOnceOnly() public {
        deposit(ALICE, ID1);
        vm.startPrank(RESOLVER);
        escrow.confirm(ALICE, ID1, false);
        vm.expectRevert(LookoutEscrow.NotLocked.selector);
        escrow.confirm(ALICE, ID1, false);
        vm.expectRevert(LookoutEscrow.NotLocked.selector);
        escrow.reject(ALICE, ID1);
        vm.stopPrank();

        deposit(ALICE, ID2);
        vm.startPrank(RESOLVER);
        escrow.reject(ALICE, ID2);
        vm.expectRevert(LookoutEscrow.NotLocked.selector);
        escrow.confirm(ALICE, ID2, false);
        vm.stopPrank();
    }

    function test_aDepositThatNeverHappenedCannotBeResolved() public {
        vm.startPrank(RESOLVER);
        vm.expectRevert(LookoutEscrow.NotLocked.selector);
        escrow.confirm(ALICE, ID1, false);
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

    function test_aRefundCannotBeBlockedByAReporterThatRefusesEth() public {
        // the refund is pulled, so a hostile reporter only hurts themselves and the resolver is never stuck
        RefusesEth bad = new RefusesEth();
        vm.deal(address(bad), 1 ether);
        vm.prank(address(bad));
        escrow.deposit{value: DEPOSIT}(ID1);
        vm.prank(RESOLVER);
        escrow.confirm(address(bad), ID1, false); // the resolver is NOT blocked
        eq(escrow.claimable(address(bad)), DEPOSIT, "owed, claimable when they can receive");
        solvent();
    }

    /* --------------------------------- refund --------------------------------- */

    function test_refundReturnsTheDepositWithNoBounty() public {
        fundPool();
        deposit(ALICE, ID1);
        vm.startPrank(RESOLVER);
        escrow.refund(ALICE, ID1);
        vm.stopPrank();
        eq(escrow.claimable(ALICE), DEPOSIT, "the deposit is claimable");
        yes(status(ALICE, ID1) == LookoutEscrow.Status.Refunded, "marked refunded");
        vm.prank(ALICE);
        escrow.claim();
        eq(ALICE.balance, 100 ether, "back to where Alice started");
        solvent();
    }

    function test_onlyTheResolverCanRefundAndOnlyOnce() public {
        deposit(ALICE, ID1);
        vm.prank(ATTACKER);
        vm.expectRevert(LookoutEscrow.NotResolver.selector);
        escrow.refund(ALICE, ID1);
        vm.startPrank(RESOLVER);
        escrow.refund(ALICE, ID1);
        vm.expectRevert(LookoutEscrow.NotLocked.selector);
        escrow.refund(ALICE, ID1);
        vm.expectRevert(LookoutEscrow.NotLocked.selector);
        escrow.confirm(ALICE, ID1, false);
        vm.expectRevert(LookoutEscrow.NotLocked.selector);
        escrow.reject(ALICE, ID1);
        vm.stopPrank();
        vm.prank(ALICE);
        vm.expectRevert(LookoutEscrow.NotLocked.selector);
        escrow.reclaim(ID1);
    }

    /* --------------------------------- bounty --------------------------------- */

    function test_confirmWithBountyCreditsTheDepositPlusTheBountyFromThePool() public {
        fundPool();
        deposit(ALICE, ID1);
        vm.prank(RESOLVER);
        escrow.confirm(ALICE, ID1, true);
        eq(escrow.claimable(ALICE), DEPOSIT + BOUNTY, "deposit and bounty are both claimable");
        eq(escrow.bountyPool(), DEPOSIT - BOUNTY, "the pool paid the bounty");
        solvent();
        vm.prank(ALICE);
        escrow.claim();
        eq(ALICE.balance, 100 ether + BOUNTY, "Alice is back to where she started, plus the bounty");
        solvent();
    }

    function test_confirmWithoutBountyReturnsOnlyTheDeposit() public {
        fundPool();
        deposit(ALICE, ID1);
        vm.prank(RESOLVER);
        escrow.confirm(ALICE, ID1, false);
        eq(escrow.claimable(ALICE), DEPOSIT, "only the deposit");
        eq(escrow.bountyPool(), DEPOSIT, "the pool is untouched");
        solvent();
    }

    function test_anEmptyPoolDoesNotBlockTheDepositRefund() public {
        deposit(ALICE, ID1);
        vm.prank(RESOLVER);
        escrow.confirm(ALICE, ID1, true); // the resolver asked for a bounty, the pool cannot afford it
        eq(escrow.claimable(ALICE), DEPOSIT, "the reporter still gets the deposit back, and the settlement did not revert");
        eq(escrow.bountyPool(), 0, "nothing was minted");
        solvent();
    }

    function test_aBountyIsAtMostOnePerConfirmedReportAndNeverFromAnotherDeposit() public {
        fundPool();
        deposit(ALICE, ID1);
        deposit(BOB, ID2);
        vm.startPrank(RESOLVER);
        escrow.confirm(ALICE, ID1, true);
        vm.expectRevert(LookoutEscrow.NotLocked.selector);
        escrow.confirm(ALICE, ID1, true); // the same report cannot be confirmed (and paid) twice
        vm.stopPrank();
        eq(escrow.claimable(ALICE), DEPOSIT + BOUNTY, "paid once");
        eq(escrow.claimable(BOB), 0, "Bob's locked deposit is not touched by Alice's bounty");
        eq(address(escrow).balance, escrow.totalLocked() + escrow.bountyPool() + escrow.totalClaimable(), "solvent");
    }

    function test_onlyTheResolverCanConfirmAndABountyNeverGoesToTheResolver() public {
        fundPool();
        deposit(ALICE, ID1);
        vm.prank(ATTACKER);
        vm.expectRevert(LookoutEscrow.NotResolver.selector);
        escrow.confirm(ALICE, ID1, true);
        eq(escrow.claimable(RESOLVER), 0, "the resolver has no claim of its own");
        vm.prank(RESOLVER);
        escrow.confirm(ALICE, ID1, true);
        eq(escrow.claimable(RESOLVER), 0, "and still none after confirming");
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
        escrow.confirm(ALICE, ID1, false);
        vm.expectRevert(LookoutEscrow.NotLocked.selector);
        escrow.reject(ALICE, ID1);
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
        escrow.confirm(ALICE, ID1, false);
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
        escrow.confirm(address(r), ID1, false);
        r.doClaim();
        eq(address(r).balance, DEPOSIT, "paid exactly once");
        yes(r.entered() == 1, "the payment did call back");
        yes(!r.innerSucceeded(), "the re-entry failed");
        eq(address(escrow).balance, DEPOSIT, "Alice's deposit is still all there");
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
        new LookoutEscrow(address(0), DEPOSIT, BOUNTY, WINDOW);
        vm.expectRevert(LookoutEscrow.BadConfig.selector);
        new LookoutEscrow(RESOLVER, 0, BOUNTY, WINDOW);
        vm.expectRevert(LookoutEscrow.BadConfig.selector);
        new LookoutEscrow(RESOLVER, DEPOSIT, BOUNTY, 0);
    }

    /* ---------------------------- solvency, fuzzed ---------------------------- */

    /// Whatever sequence of operations happens, the escrow always holds EXACTLY what it owes:
    /// locked deposits + the bounty pool + refunds waiting to be claimed.
    function testFuzz_theEscrowIsAlwaysExactlySolvent(uint256 seed) public {
        address[4] memory people = [ALICE, BOB, CAROL, address(0xD00D)];
        vm.deal(address(0xD00D), 100 ether);
        for (uint256 i = 0; i < 60; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            address who = people[seed % 4];
            bytes16 id = bytes16(uint128(seed >> 8) % 6);
            uint256 op = (seed >> 32) % 8;

            if (op == 0) { vm.prank(who); try escrow.deposit{value: DEPOSIT}(id) {} catch {} }
            else if (op == 1) { vm.prank(RESOLVER); try escrow.confirm(who, id, false) {} catch {} }
            else if (op == 2) { vm.prank(RESOLVER); try escrow.reject(who, id) {} catch {} }
            else if (op == 3) { vm.prank(who); try escrow.claim() {} catch {} }
            else if (op == 4) { vm.prank(who); try escrow.reclaim(id) {} catch {} }
            else if (op == 6) { vm.prank(RESOLVER); try escrow.refund(who, id) {} catch {} }
            else { vm.warp(block.timestamp + ((seed >> 40) % 20 days)); }

            solvent();
        }
    }
}
