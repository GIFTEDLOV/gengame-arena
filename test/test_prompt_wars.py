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

# N-player judge response (2-player match): ranking list + outputs map
JUDGE_RESPONSE = json.dumps({
    "ranking": [1, 2],
    "outputs": {
        "1": "A crisp autumn haiku: golden leaves descend",
        "2": "Leaves fall silently, painting the ground in gold",
    },
    "reasoning": "Player 1's output is a haiku structure that directly matches the target.",
})

JUDGE_RESPONSE_P2_WINS = json.dumps({
    "ranking": [2, 1],
    "outputs": {
        "1": "Some poem about autumn",
        "2": "Crimson leaves drift, Tokyo streets glow amber — autumn breathes",
    },
    "reasoning": "Player 2's haiku is more evocative and matches the target more closely.",
})


# ── helpers: decode JSON arrays stored in contract ────────────────────────────

def players(m):
    return json.loads(m.players_json) if m.players_json else []

def prompts(m):
    return json.loads(m.prompts_json) if m.prompts_json else []

def outputs(m):
    return json.loads(m.outputs_json) if m.outputs_json else []

def ranking(m):
    return json.loads(m.ranking_json) if m.ranking_json else []

def winner(m):
    r = ranking(m)
    return r[0] if r else None


def _clear_known_contract():
    """Reset GenLayer's one-contract-per-module limit so two contracts can be
    deployed within the same VM activation context."""
    for mod in list(sys.modules.values()):
        for attr in ('__known_contact__', '__known_contract__'):
            if hasattr(mod, attr):
                try:
                    setattr(mod, attr, None)
                except Exception:
                    pass


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def registry(direct_deploy, direct_vm):
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
    """Register Alice and Bob, create a 2-player match, join, host starts, and submit both prompts."""
    direct_vm.sender = ALICE_ADDR
    registry.register_user("Alice")
    direct_vm.sender = BOB_ADDR
    registry.register_user("Bob")

    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(2)
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    # Host (Alice) must explicitly start
    direct_vm.sender = ALICE_ADDR
    contract.start_match(match_id)        # → STATE_FULL

    direct_vm.sender = ALICE_ADDR
    contract.submit_prompt(match_id, "Write a haiku about autumn leaves in the city")
    direct_vm.sender = BOB_ADDR
    contract.submit_prompt(match_id, "Create a poem about leaves falling in Tokyo")

    return match_id


# ── deadline sentinel (Fix 1) ─────────────────────────────────────────────────

def test_deadline_not_set_at_create(contract, direct_vm):
    """submission_deadline is DEADLINE_UNSET (0) right after creation."""
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(2)
    m = contract.get_match(match_id)
    assert int(m.submission_deadline) == 0


def test_deadline_starts_when_host_calls_start(contract, direct_vm):
    """Clock only starts when host explicitly calls start_match, not on join."""
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(2)
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    m = contract.get_match(match_id)
    assert int(m.submission_deadline) == 0  # still unset after join
    direct_vm.sender = ALICE_ADDR
    contract.start_match(match_id)
    m = contract.get_match(match_id)
    assert int(m.submission_deadline) > 0   # set after host starts


# ── create_match ──────────────────────────────────────────────────────────────

def test_create_match_returns_incrementing_ids(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    id0 = contract.create_match(2)
    direct_vm.sender = BOB_ADDR
    id1 = contract.create_match(2)
    assert int(id0) == 0
    assert int(id1) == 1


def test_create_match_picks_valid_target(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(2)
    m = contract.get_match(match_id)
    assert m is not None
    assert len(m.target_text) > 0
    assert m.target_text in EXPECTED_TARGETS


def test_create_match_state_is_waiting(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(2)
    m = contract.get_match(match_id)
    assert int(m.state) == 0  # STATE_WAITING


def test_create_match_sets_creator_as_first_player(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(2)
    m = contract.get_match(match_id)
    assert players(m)[0].lower() == ALICE_ADDR.lower()


def test_create_match_has_one_player_at_start(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(2)
    m = contract.get_match(match_id)
    assert len(players(m)) == 1


def test_create_match_default_max_players_is_50(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match()
    m = contract.get_match(match_id)
    assert int(m.max_players) == 50


def test_create_match_custom_max_players(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(4)
    m = contract.get_match(match_id)
    assert int(m.max_players) == 4


def test_create_match_rejects_max_players_1(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("max_players must be at least 2"):
        contract.create_match(1)


def test_create_match_rejects_max_players_51(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("max_players cannot exceed 50"):
        contract.create_match(51)


# ── join_match ─────────────────────────────────────────────────────────────────

def test_join_match_adds_player(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(4)
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    m = contract.get_match(match_id)
    pl = players(m)
    assert len(pl) == 2
    assert pl[1].lower() == BOB_ADDR.lower()


def test_join_match_fills_but_stays_waiting(contract, direct_vm):
    """Filling to capacity does NOT auto-start — state remains WAITING."""
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(2)
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    m = contract.get_match(match_id)
    assert int(m.state) == 0  # STATE_WAITING (not auto-started)
    assert int(m.submission_deadline) == 0  # deadline not set


def test_join_match_does_not_start_clock_when_not_full(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(4)
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    m = contract.get_match(match_id)
    assert int(m.state) == 0  # STATE_WAITING still
    assert int(m.submission_deadline) == 0  # not started


def test_join_match_duplicate_rejected(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(4)
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    with direct_vm.expect_revert("Already joined this match"):
        contract.join_match(match_id)


def test_join_match_full_rejected(contract, direct_vm):
    """Joining a full match (at max_players) is rejected with 'Match is full'."""
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(2)
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)   # fills slots, state stays WAITING
    direct_vm.sender = CAROL_ADDR
    with direct_vm.expect_revert("Match is full"):
        contract.join_match(match_id)


def test_join_match_not_found(contract, direct_vm):
    direct_vm.sender = BOB_ADDR
    with direct_vm.expect_revert("Match not found"):
        contract.join_match(99)


def test_join_match_up_to_capacity(contract, direct_vm):
    addrs = [ALICE_ADDR, BOB_ADDR, CAROL_ADDR, DAVE_ADDR]
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(4)
    for addr in addrs[1:]:
        direct_vm.sender = addr
        contract.join_match(match_id)
    m = contract.get_match(match_id)
    assert len(players(m)) == 4
    assert int(m.state) == 0  # WAITING — no auto-start


# ── start_match ───────────────────────────────────────────────────────────────

def test_start_match_starts_clock_with_2_players(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(10)
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.sender = ALICE_ADDR
    contract.start_match(match_id)
    m = contract.get_match(match_id)
    assert int(m.state) == 1  # STATE_FULL
    assert int(m.submission_deadline) > 0


def test_start_match_rejects_with_1_player(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(10)
    with direct_vm.expect_revert("Need at least 2 players to start"):
        contract.start_match(match_id)


def test_start_match_rejects_non_host(contract, direct_vm):
    """Only the host (players[0]) can start — joined non-host or non-player both rejected."""
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(10)
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    # Carol is not a player at all
    direct_vm.sender = CAROL_ADDR
    with direct_vm.expect_revert("Only the host can start the match"):
        contract.start_match(match_id)


def test_start_match_rejects_non_host_player(contract, direct_vm):
    """Bob has joined but is not the host — must be rejected."""
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(10)
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.sender = BOB_ADDR
    with direct_vm.expect_revert("Only the host can start the match"):
        contract.start_match(match_id)


def test_start_match_rejects_already_started(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(2)
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.sender = ALICE_ADDR
    contract.start_match(match_id)  # → STATE_FULL
    with direct_vm.expect_revert("Match has already started or is finished"):
        contract.start_match(match_id)


# ── submit_prompt ─────────────────────────────────────────────────────────────

def _started_2p(contract, direct_vm):
    """Helper: create a 2-player match and have the host start it."""
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(2)
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.sender = ALICE_ADDR
    contract.start_match(match_id)
    return match_id


def test_submit_prompt_player1(contract, direct_vm):
    match_id = _started_2p(contract, direct_vm)
    direct_vm.sender = ALICE_ADDR
    contract.submit_prompt(match_id, "My haiku prompt")
    m = contract.get_match(match_id)
    assert prompts(m)[0] == "My haiku prompt"


def test_submit_prompt_player2(contract, direct_vm):
    match_id = _started_2p(contract, direct_vm)
    direct_vm.sender = BOB_ADDR
    contract.submit_prompt(match_id, "Bob's haiku prompt")
    m = contract.get_match(match_id)
    assert prompts(m)[1] == "Bob's haiku prompt"


def test_submit_prompt_non_player_rejected(contract, direct_vm):
    match_id = _started_2p(contract, direct_vm)
    direct_vm.sender = CAROL_ADDR
    with direct_vm.expect_revert("Not a player in this match"):
        contract.submit_prompt(match_id, "Intruder prompt")


def test_submit_prompt_idempotent_update_allowed(contract, direct_vm):
    """Players can update their prompt before the deadline (idempotent)."""
    match_id = _started_2p(contract, direct_vm)
    direct_vm.sender = ALICE_ADDR
    contract.submit_prompt(match_id, "First prompt")
    contract.submit_prompt(match_id, "Updated prompt")
    m = contract.get_match(match_id)
    assert prompts(m)[0] == "Updated prompt"


def test_submit_prompt_too_long_rejected(contract, direct_vm):
    match_id = _started_2p(contract, direct_vm)
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Prompt exceeds 500 characters"):
        contract.submit_prompt(match_id, "x" * 501)


def test_submit_prompt_exactly_500_chars_allowed(contract, direct_vm):
    match_id = _started_2p(contract, direct_vm)
    direct_vm.sender = ALICE_ADDR
    contract.submit_prompt(match_id, "x" * 500)
    m = contract.get_match(match_id)
    assert len(prompts(m)[0]) == 500


def test_submit_before_match_full_rejected(contract, direct_vm):
    """Cannot submit when match is still in WAITING state."""
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(4)
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    # Only 2/4 joined → still WAITING
    with direct_vm.expect_revert("Match is not in submission phase"):
        contract.submit_prompt(match_id, "Too early")


# ── state transitions ─────────────────────────────────────────────────────────

def test_state_waiting_to_full_on_start(contract, direct_vm):
    """State goes WAITING → FULL only when host calls start_match, not on join."""
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(2)
    assert int(contract.get_match(match_id).state) == 0  # WAITING

    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    assert int(contract.get_match(match_id).state) == 0  # still WAITING

    direct_vm.sender = ALICE_ADDR
    contract.start_match(match_id)
    assert int(contract.get_match(match_id).state) == 1  # FULL


def test_state_full_to_judged(contract, direct_vm, full_match):
    direct_vm.mock_llm(".*", JUDGE_RESPONSE)
    contract.judge_match(full_match)
    assert int(contract.get_match(full_match).state) == 2  # JUDGED


# ── judge_match ───────────────────────────────────────────────────────────────

def test_judge_match_requires_all_submitted_before_deadline(contract, direct_vm):
    """STATE_FULL but not all submitted and deadline not passed → reject."""
    match_id = _started_2p(contract, direct_vm)
    # Nobody submitted yet
    with direct_vm.expect_revert("Waiting for all players to submit or deadline to pass"):
        contract.judge_match(match_id)


def test_judge_match_requires_all_or_deadline_partial(contract, direct_vm):
    """ONE submitted, deadline not passed → reject."""
    match_id = _started_2p(contract, direct_vm)
    direct_vm.sender = ALICE_ADDR
    contract.submit_prompt(match_id, "Alice prompt")
    with direct_vm.expect_revert("Waiting for all players to submit or deadline to pass"):
        contract.judge_match(match_id)


def test_judge_match_declares_player1_winner(contract, direct_vm, full_match):
    direct_vm.mock_llm(".*", JUDGE_RESPONSE)
    contract.judge_match(full_match)
    m = contract.get_match(full_match)
    assert int(m.state) == 2  # JUDGED
    assert winner(m).lower() == ALICE_ADDR.lower()


def test_judge_match_declares_player2_winner(contract, direct_vm, full_match):
    direct_vm.mock_llm(".*", JUDGE_RESPONSE_P2_WINS)
    contract.judge_match(full_match)
    m = contract.get_match(full_match)
    assert winner(m).lower() == BOB_ADDR.lower()


def test_judge_match_stores_outputs_and_reasoning(contract, direct_vm, full_match):
    direct_vm.mock_llm(".*", JUDGE_RESPONSE)
    contract.judge_match(full_match)
    m = contract.get_match(full_match)
    outs = outputs(m)
    assert len(outs[0]) > 0
    assert len(outs[1]) > 0
    assert len(m.judge_reasoning) > 0


def test_judge_match_ranking_order(contract, direct_vm, full_match):
    """ranking_json[0] = winner, ranking_json[1] = runner-up."""
    direct_vm.mock_llm(".*", JUDGE_RESPONSE)
    contract.judge_match(full_match)
    m = contract.get_match(full_match)
    r = ranking(m)
    assert len(r) == 2
    assert r[0].lower() == ALICE_ADDR.lower()
    assert r[1].lower() == BOB_ADDR.lower()


def test_judge_match_uses_eq_principle(contract, direct_vm, full_match):
    direct_vm.mock_llm(".*", JUDGE_RESPONSE)
    contract.judge_match(full_match)
    assert len(direct_vm._captured_validators) > 0


def test_judge_match_calls_record_match_on_registry(contract, registry, direct_vm, full_match):
    def _hook(vm, request):
        if "PostMessage" not in request:
            return None
        msg = request["PostMessage"]
        cd = msg.get("calldata", {})
        if not isinstance(cd, dict):
            return {"ok": None}
        if cd.get("method") == "record_match_batch" and cd.get("args"):
            registry.record_match_batch(cd["args"][0])
        return {"ok": None}

    direct_vm._gl_call_hook = _hook
    direct_vm.mock_llm(".*", JUDGE_RESPONSE)
    contract.judge_match(full_match)
    direct_vm._gl_call_hook = None

    alice_profile = registry.get_profile(ALICE_ADDR)
    bob_profile = registry.get_profile(BOB_ADDR)
    assert int(alice_profile.total_matches) == 1
    assert int(bob_profile.total_matches) == 1
    assert int(alice_profile.total_wins) + int(bob_profile.total_wins) == 1


# ── get_recent_matches ────────────────────────────────────────────────────────

def test_get_recent_matches_empty(contract, direct_vm):
    result = contract.get_recent_matches(10)
    assert result == []


def test_get_recent_matches_correct_order(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.create_match(2)
    direct_vm.sender = BOB_ADDR
    contract.create_match(2)
    direct_vm.sender = CAROL_ADDR
    contract.create_match(2)

    matches = contract.get_recent_matches(10)
    assert len(matches) == 3
    assert int(matches[0].id) == 2
    assert int(matches[1].id) == 1
    assert int(matches[2].id) == 0


def test_get_recent_matches_respects_limit(contract, direct_vm):
    for addr in [ALICE_ADDR, BOB_ADDR, CAROL_ADDR, DAVE_ADDR]:
        direct_vm.sender = addr
        contract.create_match(2)

    matches = contract.get_recent_matches(2)
    assert len(matches) == 2
    assert int(matches[0].id) == 3
    assert int(matches[1].id) == 2


# ── get_matches_for_player ────────────────────────────────────────────────────

def test_get_matches_for_player(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    id0 = contract.create_match(4)
    direct_vm.sender = BOB_ADDR
    contract.join_match(id0)
    direct_vm.sender = BOB_ADDR
    id1 = contract.create_match(2)

    alice_ids = [int(x) for x in contract.get_matches_for_player(ALICE_ADDR)]
    bob_ids   = [int(x) for x in contract.get_matches_for_player(BOB_ADDR)]

    assert int(id0) in alice_ids
    assert int(id0) in bob_ids
    assert int(id1) in bob_ids
    assert int(id1) not in alice_ids


# ── forfeit (deadline passed, only one submitted) ─────────────────────────────

@pytest.fixture
def one_submitted_expired(contract, registry, direct_vm):
    """2-player match where only Alice submitted before the deadline expired."""
    direct_vm.sender = ALICE_ADDR
    registry.register_user("Alice")
    direct_vm.sender = BOB_ADDR
    registry.register_user("Bob")

    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(2)
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.sender = ALICE_ADDR
    contract.start_match(match_id)   # host starts → STATE_FULL
    contract.submit_prompt(match_id, "Alice's prompt")

    direct_vm.warp((datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=7200)).isoformat())
    return match_id


def test_forfeit_p1_wins_when_only_p1_submitted(contract, direct_vm, one_submitted_expired):
    contract.judge_match(one_submitted_expired)
    m = contract.get_match(one_submitted_expired)
    assert int(m.state) == 2  # JUDGED
    assert winner(m).lower() == ALICE_ADDR.lower()


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
    match_id = contract.create_match(2)
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.sender = ALICE_ADDR
    contract.start_match(match_id)   # host starts
    direct_vm.sender = BOB_ADDR
    contract.submit_prompt(match_id, "Bob's prompt")

    direct_vm.warp((datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=7200)).isoformat())
    contract.judge_match(match_id)
    m = contract.get_match(match_id)
    assert winner(m).lower() == BOB_ADDR.lower()


def test_forfeit_records_stats(contract, registry, direct_vm, one_submitted_expired):
    def _hook(vm, request):
        if "PostMessage" not in request:
            return None
        msg = request["PostMessage"]
        cd = msg.get("calldata", {})
        if not isinstance(cd, dict):
            return {"ok": None}
        if cd.get("method") == "record_match_batch" and cd.get("args"):
            registry.record_match_batch(cd["args"][0])
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


# ── no-contest (deadline passed, nobody submitted) ────────────────────────────

@pytest.fixture
def both_joined_expired(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(2)
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.sender = ALICE_ADDR
    contract.start_match(match_id)   # host starts → STATE_FULL
    direct_vm.warp((datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=7200)).isoformat())
    return match_id


def test_no_contest_state_is_judged(contract, direct_vm, both_joined_expired):
    contract.judge_match(both_joined_expired)
    m = contract.get_match(both_joined_expired)
    assert int(m.state) == 2  # JUDGED


def test_no_contest_ranking_is_empty(contract, direct_vm, both_joined_expired):
    contract.judge_match(both_joined_expired)
    m = contract.get_match(both_joined_expired)
    assert ranking(m) == []


def test_no_contest_reasoning_set(contract, direct_vm, both_joined_expired):
    contract.judge_match(both_joined_expired)
    m = contract.get_match(both_joined_expired)
    assert "no contest" in m.judge_reasoning.lower() or "neither" in m.judge_reasoning.lower()


def test_no_contest_does_not_record_stats(contract, registry, direct_vm, both_joined_expired):
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
    match_id = contract.create_match(4)
    direct_vm.warp((datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=7200)).isoformat())
    return match_id


def test_cancel_match_sets_cancelled_state(contract, direct_vm, waiting_expired):
    direct_vm.sender = ALICE_ADDR
    contract.cancel_match(waiting_expired)
    m = contract.get_match(waiting_expired)
    assert int(m.state) == 3  # CANCELLED


def test_cancel_match_only_creator_can_cancel(contract, direct_vm, waiting_expired):
    direct_vm.sender = BOB_ADDR
    with direct_vm.expect_revert("Only the match creator can cancel"):
        contract.cancel_match(waiting_expired)


def test_cancel_match_requires_waiting_state(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(2)
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.sender = ALICE_ADDR
    contract.start_match(match_id)   # → STATE_FULL
    direct_vm.warp((datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=7200)).isoformat())
    with direct_vm.expect_revert("Can only cancel a match that is still waiting for players"):
        contract.cancel_match(match_id)


def test_cancel_match_requires_deadline_passed(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(4)
    # Deadline NOT passed yet (created < 5 min ago)
    with direct_vm.expect_revert("Can only cancel after the deadline has passed"):
        contract.cancel_match(match_id)


# ── N-player specific tests ───────────────────────────────────────────────────

@pytest.fixture
def three_player_full_match(contract, registry, direct_vm):
    """3-player match, all submitted."""
    for name, addr in [("Alice", ALICE_ADDR), ("Bob", BOB_ADDR), ("Carol", CAROL_ADDR)]:
        direct_vm.sender = addr
        registry.register_user(name)

    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(3)
    for addr in [BOB_ADDR, CAROL_ADDR]:
        direct_vm.sender = addr
        contract.join_match(match_id)
    direct_vm.sender = ALICE_ADDR
    contract.start_match(match_id)   # host starts → STATE_FULL

    direct_vm.sender = ALICE_ADDR
    contract.submit_prompt(match_id, "Alice haiku prompt")
    direct_vm.sender = BOB_ADDR
    contract.submit_prompt(match_id, "Bob haiku prompt")
    direct_vm.sender = CAROL_ADDR
    contract.submit_prompt(match_id, "Carol haiku prompt")
    return match_id


def test_n_player_ranking_has_all_players(contract, direct_vm, three_player_full_match):
    three_player_response = json.dumps({
        "ranking": [2, 1, 3],
        "outputs": {"1": "Alice out", "2": "Bob out", "3": "Carol out"},
        "reasoning": "Bob won; Alice second; Carol third.",
    })
    direct_vm.mock_llm(".*", three_player_response)
    contract.judge_match(three_player_full_match)
    m = contract.get_match(three_player_full_match)
    assert int(m.state) == 2  # JUDGED
    r = ranking(m)
    assert len(r) == 3
    # ranking[0] = Bob (player index 1, 1-based number 2)
    assert r[0].lower() == BOB_ADDR.lower()
    assert r[1].lower() == ALICE_ADDR.lower()
    assert r[2].lower() == CAROL_ADDR.lower()


def test_start_match_early_with_fewer_than_max(contract, direct_vm):
    """start_match lets a 3-player subset of a 10-player match begin."""
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(10)
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    direct_vm.sender = CAROL_ADDR
    contract.join_match(match_id)

    assert int(contract.get_match(match_id).state) == 0  # still WAITING

    direct_vm.sender = ALICE_ADDR
    contract.start_match(match_id)

    m = contract.get_match(match_id)
    assert int(m.state) == 1  # FULL
    assert int(m.submission_deadline) > 0


def test_n_player_partial_submission_after_deadline(contract, direct_vm):
    """With deadline passed and 2/3 submitted, judge_match should not fail."""
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(3)
    for addr in [BOB_ADDR, CAROL_ADDR]:
        direct_vm.sender = addr
        contract.join_match(match_id)
    direct_vm.sender = ALICE_ADDR
    contract.start_match(match_id)   # host starts
    # Alice and Bob submit; Carol does not
    direct_vm.sender = ALICE_ADDR
    contract.submit_prompt(match_id, "Alice prompt")
    direct_vm.sender = BOB_ADDR
    contract.submit_prompt(match_id, "Bob prompt")

    direct_vm.warp((datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=7200)).isoformat())

    # Carol didn't submit: she should rank last
    three_partial = json.dumps({
        "ranking": [1, 2, 3],
        "outputs": {"1": "Alice out", "2": "Bob out", "3": ""},
        "reasoning": "Alice and Bob submitted; Carol did not.",
    })
    direct_vm.mock_llm(".*", three_partial)
    contract.judge_match(match_id)
    m = contract.get_match(match_id)
    assert int(m.state) == 2  # JUDGED
    r = ranking(m)
    assert len(r) == 3
    assert r[0].lower() == ALICE_ADDR.lower()
