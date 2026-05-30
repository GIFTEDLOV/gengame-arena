import pytest
import json
import sys
import datetime

# Subset of targets used to verify the contract picks from the real list
EXPECTED_TARGETS = [
    "A prompt that produces a 4-line poem about silence",
    "A prompt that produces instructions for making perfect scrambled eggs in under 50 words",
    "A prompt that produces a riddle whose answer is 'a mirror'",
    "A prompt that produces a haiku about autumn leaves falling in a city park",
    "A prompt that produces a one-sentence summary of the French Revolution",
    "A prompt that produces a limerick about a programmer debugging at 3am",
    "A prompt that produces a children's bedtime story in exactly 3 sentences",
    "A prompt that produces the opening line of a gothic horror novel",
    "A prompt that produces advice for someone learning to ride a bicycle",
    "A prompt that produces a tweet-length explanation of photosynthesis",
    "A prompt that produces a recipe for friendship written as a cooking recipe",
    "A prompt that produces a definition of 'home' without using the word 'house'",
    "A prompt that produces a description of rain using only the five senses",
    "A prompt that produces a motivational quote about perseverance under 20 words",
    "A prompt that produces a two-sentence story with a surprise twist ending",
    "A prompt that produces the moral of the story of Icarus in one sentence",
    "A prompt that produces a metaphor comparing the internet to something in nature",
    "A prompt that produces a 5-step morning mindfulness routine",
    "A prompt that produces a joke requiring knowledge of both history and science",
    "A prompt that produces a description of loneliness from a lighthouse's point of view",
    "A prompt that produces an argument for why cats are better pets than dogs",
    "A prompt that produces a list of 5 things that are both beautiful and terrifying",
    "A prompt that produces an explanation of blockchain suitable for a 10-year-old",
    "A prompt that produces a short dialogue between the sun and the moon",
    "A prompt that produces a unique book title about time travel",
    "A prompt that produces a 6-word story about regret",
    "A prompt that produces a description of the color blue to someone born blind",
    "A prompt that produces advice for someone starting their first day at a new job",
    "A prompt that produces a superhero origin story in exactly 4 sentences",
    "A prompt that produces a wedding toast for two people who met at a hackathon",
]

ALICE_ADDR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
BOB_ADDR   = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
CAROL_ADDR = "0xcccccccccccccccccccccccccccccccccccccccc"
DAVE_ADDR  = "0xdddddddddddddddddddddddddddddddddddddddd"

JUDGE_RESPONSE = json.dumps({
    "player1_output": "A crisp autumn haiku: golden leaves descend",
    "player2_output": "Leaves fall silently, painting the ground in gold",
    "winner": 1,
    "reasoning": "Player 1's output is a haiku structure that directly matches the target.",
})

JUDGE_RESPONSE_P2_WINS = json.dumps({
    "player1_output": "Some poem about autumn",
    "player2_output": "Crimson leaves drift, Tokyo streets glow amber — autumn breathes",
    "winner": 2,
    "reasoning": "Player 2's haiku is more evocative and matches the target more closely.",
})


def _clear_known_contract():
    """Reset GenLayer's one-contract-per-module limit so two contracts can be
    deployed within the same VM activation context."""
    for mod in list(sys.modules.values()):
        # SDK uses __known_contact__ (typo in source — missing 'r')
        for attr in ('__known_contact__', '__known_contract__'):
            if hasattr(mod, attr):
                try:
                    setattr(mod, attr, None)
                except Exception:
                    pass


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def registry(direct_deploy, direct_vm):
    # gltest allocates every contract at ROOT_SLOT_ID in vm._storage.
    # Deploying two contracts against the same VM would corrupt each other's
    # storage at that shared slot. Fix: give registry its own InmemManager so
    # PromptWars' constructor writes can't reach registry's TreeMap metadata.
    from gltest.direct.vm import InmemManager as _InmemManager
    original_storage = direct_vm._storage
    direct_vm._storage = _InmemManager()
    direct_vm.sender = ALICE_ADDR
    try:
        result = direct_deploy("contracts/user_registry.py")
    finally:
        direct_vm._storage = original_storage
    return result


@pytest.fixture
def contract(direct_deploy, direct_vm, registry):
    _clear_known_contract()
    direct_vm.sender = ALICE_ADDR
    return direct_deploy("contracts/prompt_wars.py", registry.address)


@pytest.fixture
def full_match(contract, registry, direct_vm):
    """Register both players, create a match, join it, and submit both prompts."""
    direct_vm.sender = ALICE_ADDR
    registry.register_user("Alice")
    direct_vm.sender = BOB_ADDR
    registry.register_user("Bob")

    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)

    direct_vm.sender = ALICE_ADDR
    contract.submit_prompt(match_id, "Write a haiku about autumn leaves in the city")
    direct_vm.sender = BOB_ADDR
    contract.submit_prompt(match_id, "Create a poem about leaves falling in Tokyo")

    return match_id


# ── create_match ──────────────────────────────────────────────────────────────

def test_create_match_returns_incrementing_ids(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    id0 = contract.create_match()
    direct_vm.sender = BOB_ADDR
    id1 = contract.create_match()
    assert int(id0) == 0
    assert int(id1) == 1


def test_create_match_picks_valid_target(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    m = contract.get_match(match_id)
    assert m is not None
    assert len(m.target_text) > 0
    assert m.target_text in EXPECTED_TARGETS


def test_create_match_state_is_waiting_for_p2(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    m = contract.get_match(match_id)
    assert int(m.state) == 0  # WAITING_FOR_P2


def test_create_match_sets_player1(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    m = contract.get_match(match_id)
    assert str(m.player1).lower() == ALICE_ADDR.lower()


def test_create_match_player2_is_not_player1(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    m = contract.get_match(match_id)
    # player2 is the zero address (not yet set) — it differs from player1
    assert str(m.player2).lower() != ALICE_ADDR.lower()


# ── join_match ─────────────────────────────────────────────────────────────────

def test_join_match_succeeds(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    m = contract.get_match(match_id)
    assert str(m.player2).lower() == BOB_ADDR.lower()
    assert int(m.state) == 1  # BOTH_JOINED


def test_join_match_self_join_rejected(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    with direct_vm.expect_revert("Cannot join your own match"):
        contract.join_match(match_id)


def test_join_match_full_rejected(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.sender = CAROL_ADDR
    with direct_vm.expect_revert("Match already has two players"):
        contract.join_match(match_id)


def test_join_match_not_found(contract, direct_vm):
    direct_vm.sender = BOB_ADDR
    with direct_vm.expect_revert("Match not found"):
        contract.join_match(99)


# ── submit_prompt ─────────────────────────────────────────────────────────────

def test_submit_prompt_player1(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.sender = ALICE_ADDR
    contract.submit_prompt(match_id, "My haiku prompt")
    m = contract.get_match(match_id)
    assert m.player1_prompt == "My haiku prompt"
    assert int(m.state) == 2  # ONE_SUBMITTED


def test_submit_prompt_player2(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.sender = BOB_ADDR
    contract.submit_prompt(match_id, "Bob's haiku prompt")
    m = contract.get_match(match_id)
    assert m.player2_prompt == "Bob's haiku prompt"


def test_submit_prompt_non_player_rejected(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.sender = CAROL_ADDR
    with direct_vm.expect_revert("Not a player in this match"):
        contract.submit_prompt(match_id, "Intruder prompt")


def test_submit_prompt_twice_rejected(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.sender = ALICE_ADDR
    contract.submit_prompt(match_id, "First prompt")
    with direct_vm.expect_revert("Already submitted"):
        contract.submit_prompt(match_id, "Second attempt")


def test_submit_prompt_too_long_rejected(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Prompt exceeds 500 characters"):
        contract.submit_prompt(match_id, "x" * 501)


def test_submit_prompt_exactly_500_chars_allowed(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.sender = ALICE_ADDR
    contract.submit_prompt(match_id, "x" * 500)
    m = contract.get_match(match_id)
    assert len(m.player1_prompt) == 500


def test_submit_before_join_rejected(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    with direct_vm.expect_revert("Match is not in submission phase"):
        contract.submit_prompt(match_id, "Too early")


# ── state transitions ─────────────────────────────────────────────────────────

def test_state_waiting_to_both_joined(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    assert int(contract.get_match(match_id).state) == 0

    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    assert int(contract.get_match(match_id).state) == 1


def test_state_both_joined_to_one_submitted(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.sender = ALICE_ADDR
    contract.submit_prompt(match_id, "Alice prompt")
    assert int(contract.get_match(match_id).state) == 2


def test_state_one_submitted_to_both_submitted(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.sender = ALICE_ADDR
    contract.submit_prompt(match_id, "Alice prompt")
    direct_vm.sender = BOB_ADDR
    contract.submit_prompt(match_id, "Bob prompt")
    assert int(contract.get_match(match_id).state) == 3


def test_state_both_submitted_to_judged(contract, direct_vm, full_match):
    direct_vm.mock_llm(".*", JUDGE_RESPONSE)
    contract.judge_match(full_match)
    assert int(contract.get_match(full_match).state) == 4


# ── judge_match ───────────────────────────────────────────────────────────────

def test_judge_match_requires_both_submitted_before_deadline(contract, direct_vm):
    """BOTH_JOINED before deadline — judging not yet allowed."""
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    with direct_vm.expect_revert("Match is not in a judgeable state"):
        contract.judge_match(match_id)


def test_judge_match_requires_both_not_just_one_before_deadline(contract, direct_vm):
    """ONE_SUBMITTED before deadline — judging not yet allowed."""
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.sender = ALICE_ADDR
    contract.submit_prompt(match_id, "Alice prompt")
    with direct_vm.expect_revert("Match is not in a judgeable state"):
        contract.judge_match(match_id)


def test_judge_match_declares_player1_winner(contract, direct_vm, full_match):
    direct_vm.mock_llm(".*", JUDGE_RESPONSE)
    contract.judge_match(full_match)
    m = contract.get_match(full_match)
    assert int(m.state) == 4
    assert str(m.winner).lower() == ALICE_ADDR.lower()


def test_judge_match_declares_player2_winner(contract, direct_vm, full_match):
    direct_vm.mock_llm(".*", JUDGE_RESPONSE_P2_WINS)
    contract.judge_match(full_match)
    m = contract.get_match(full_match)
    assert str(m.winner).lower() == BOB_ADDR.lower()


def test_judge_match_stores_outputs_and_reasoning(contract, direct_vm, full_match):
    direct_vm.mock_llm(".*", JUDGE_RESPONSE)
    contract.judge_match(full_match)
    m = contract.get_match(full_match)
    assert len(m.player1_output) > 0
    assert len(m.player2_output) > 0
    assert len(m.judge_reasoning) > 0


def test_judge_match_uses_eq_principle(contract, direct_vm, full_match):
    """eq_principle.prompt_comparative should register a validator entry."""
    direct_vm.mock_llm(".*", JUDGE_RESPONSE)
    contract.judge_match(full_match)
    assert len(direct_vm._captured_validators) > 0


def test_judge_match_calls_record_match_on_registry(contract, registry, direct_vm, full_match):
    """PostMessage to user_registry.record_match should be forwarded correctly."""
    # full_match fixture already registered Alice and Bob
    captured = []

    def _hook(vm, request):
        if "PostMessage" not in request:
            return None
        msg = request["PostMessage"]
        cd = msg.get("calldata", {})
        if not isinstance(cd, dict):
            return {"ok": None}
        method = cd.get("method")
        args = cd.get("args", [])
        if method == "record_match" and len(args) >= 2:
            player_addr, won = args[0], args[1]
            registry.record_match(player_addr, won)
            captured.append((str(player_addr).lower(), bool(won)))
        return {"ok": None}

    direct_vm._gl_call_hook = _hook
    direct_vm.mock_llm(".*", JUDGE_RESPONSE)
    contract.judge_match(full_match)
    direct_vm._gl_call_hook = None

    alice_profile = registry.get_profile(ALICE_ADDR)
    bob_profile = registry.get_profile(BOB_ADDR)
    assert int(alice_profile.total_matches) == 1
    assert int(bob_profile.total_matches) == 1
    # Exactly one player won
    assert int(alice_profile.total_wins) + int(bob_profile.total_wins) == 1


# ── get_recent_matches ────────────────────────────────────────────────────────

def test_get_recent_matches_empty(contract, direct_vm):
    result = contract.get_recent_matches(10)
    assert result == []


def test_get_recent_matches_correct_order(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.create_match()
    direct_vm.sender = BOB_ADDR
    contract.create_match()
    direct_vm.sender = CAROL_ADDR
    contract.create_match()

    matches = contract.get_recent_matches(10)
    assert len(matches) == 3
    assert int(matches[0].id) == 2  # most recent first
    assert int(matches[1].id) == 1
    assert int(matches[2].id) == 0


def test_get_recent_matches_respects_limit(contract, direct_vm):
    for addr in [ALICE_ADDR, BOB_ADDR, CAROL_ADDR, DAVE_ADDR]:
        direct_vm.sender = addr
        contract.create_match()

    matches = contract.get_recent_matches(2)
    assert len(matches) == 2
    assert int(matches[0].id) == 3
    assert int(matches[1].id) == 2


# ── get_matches_for_player ────────────────────────────────────────────────────

def test_get_matches_for_player(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    id0 = contract.create_match()
    direct_vm.sender = BOB_ADDR
    contract.join_match(id0)
    direct_vm.sender = BOB_ADDR
    id1 = contract.create_match()

    alice_ids = [int(x) for x in contract.get_matches_for_player(ALICE_ADDR)]
    bob_ids   = [int(x) for x in contract.get_matches_for_player(BOB_ADDR)]

    assert int(id0) in alice_ids
    assert int(id0) in bob_ids
    assert int(id1) in bob_ids
    assert int(id1) not in alice_ids


# ── forfeit (ONE_SUBMITTED + deadline passed) ─────────────────────────────────

@pytest.fixture
def one_submitted_expired(contract, registry, direct_vm):
    """Match where only Alice submitted before the deadline expired."""
    direct_vm.sender = ALICE_ADDR
    registry.register_user("Alice")
    direct_vm.sender = BOB_ADDR
    registry.register_user("Bob")

    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.sender = ALICE_ADDR
    contract.submit_prompt(match_id, "Alice's prompt")

    # Expire the deadline
    direct_vm.warp((datetime.datetime.utcnow() + datetime.timedelta(seconds=7200)).isoformat() + "Z")
    return match_id


def test_forfeit_p1_wins_when_only_p1_submitted(contract, direct_vm, one_submitted_expired):
    contract.judge_match(one_submitted_expired)
    m = contract.get_match(one_submitted_expired)
    assert int(m.state) == 4  # JUDGED
    assert str(m.winner).lower() == ALICE_ADDR.lower()


def test_forfeit_reasoning_mentions_deadline(contract, direct_vm, one_submitted_expired):
    contract.judge_match(one_submitted_expired)
    m = contract.get_match(one_submitted_expired)
    assert "forfeit" in m.judge_reasoning.lower() or "deadline" in m.judge_reasoning.lower()


def test_forfeit_p2_wins_when_only_p2_submitted(contract, registry, direct_vm):
    direct_vm.sender = ALICE_ADDR
    registry.register_user("Alice2")
    direct_vm.sender = BOB_ADDR
    registry.register_user("Bob2")

    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.sender = BOB_ADDR
    contract.submit_prompt(match_id, "Bob's prompt")

    direct_vm.warp((datetime.datetime.utcnow() + datetime.timedelta(seconds=7200)).isoformat() + "Z")
    contract.judge_match(match_id)
    m = contract.get_match(match_id)
    assert str(m.winner).lower() == BOB_ADDR.lower()


def test_forfeit_records_stats(contract, registry, direct_vm, one_submitted_expired):
    captured = []

    def _hook(vm, request):
        if "PostMessage" not in request:
            return None
        msg = request["PostMessage"]
        cd = msg.get("calldata", {})
        if not isinstance(cd, dict):
            return {"ok": None}
        method = cd.get("method")
        args = cd.get("args", [])
        if method == "record_match" and len(args) >= 2:
            registry.record_match(args[0], args[1])
            captured.append((str(args[0]).lower(), bool(args[1])))
        return {"ok": None}

    direct_vm._gl_call_hook = _hook
    contract.judge_match(one_submitted_expired)
    direct_vm._gl_call_hook = None

    alice_profile = registry.get_profile(ALICE_ADDR)
    bob_profile = registry.get_profile(BOB_ADDR)
    assert int(alice_profile.total_wins) == 1
    assert int(bob_profile.total_wins) == 0
    assert int(alice_profile.total_matches) == 1
    assert int(bob_profile.total_matches) == 1


# ── no-contest (BOTH_JOINED + deadline passed) ────────────────────────────────

@pytest.fixture
def both_joined_expired(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.warp((datetime.datetime.utcnow() + datetime.timedelta(seconds=7200)).isoformat() + "Z")
    return match_id


def test_no_contest_state_is_judged(contract, direct_vm, both_joined_expired):
    contract.judge_match(both_joined_expired)
    m = contract.get_match(both_joined_expired)
    assert int(m.state) == 4  # JUDGED


def test_no_contest_winner_is_zero(contract, direct_vm, both_joined_expired):
    contract.judge_match(both_joined_expired)
    m = contract.get_match(both_joined_expired)
    ZERO = "0x" + "0" * 40
    assert str(m.winner).lower() == ZERO


def test_no_contest_reasoning_set(contract, direct_vm, both_joined_expired):
    contract.judge_match(both_joined_expired)
    m = contract.get_match(both_joined_expired)
    assert "no contest" in m.judge_reasoning.lower() or "neither" in m.judge_reasoning.lower()


def test_no_contest_does_not_record_stats(contract, registry, direct_vm, both_joined_expired):
    """No-contest must NOT call record_match for either player."""
    direct_vm.sender = ALICE_ADDR
    registry.register_user("AliceNC")
    direct_vm.sender = BOB_ADDR
    registry.register_user("BobNC")

    called = []

    def _hook(vm, request):
        if "PostMessage" in request:
            msg = request["PostMessage"]
            cd = msg.get("calldata", {})
            if isinstance(cd, dict) and cd.get("method") == "record_match":
                called.append(cd)
        return {"ok": None}

    direct_vm._gl_call_hook = _hook
    contract.judge_match(both_joined_expired)
    direct_vm._gl_call_hook = None
    assert len(called) == 0, "No-contest should not record any match stats"


# ── cancel_match ──────────────────────────────────────────────────────────────

@pytest.fixture
def waiting_expired(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    direct_vm.warp((datetime.datetime.utcnow() + datetime.timedelta(seconds=7200)).isoformat() + "Z")
    return match_id


def test_cancel_match_sets_cancelled_state(contract, direct_vm, waiting_expired):
    direct_vm.sender = ALICE_ADDR
    contract.cancel_match(waiting_expired)
    m = contract.get_match(waiting_expired)
    assert int(m.state) == 5  # CANCELLED


def test_cancel_match_only_player1_can_cancel(contract, direct_vm, waiting_expired):
    direct_vm.sender = BOB_ADDR
    with direct_vm.expect_revert("Only Player 1 can cancel"):
        contract.cancel_match(waiting_expired)


def test_cancel_match_requires_waiting_for_p2_state(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.warp((datetime.datetime.utcnow() + datetime.timedelta(seconds=7200)).isoformat() + "Z")
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Can only cancel a match that is still waiting for Player 2"):
        contract.cancel_match(match_id)


def test_cancel_match_requires_deadline_passed(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    # Deadline NOT passed yet
    with direct_vm.expect_revert("Can only cancel after the deadline has passed"):
        contract.cancel_match(match_id)
