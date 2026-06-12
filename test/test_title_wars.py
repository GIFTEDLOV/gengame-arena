import pytest
import json
import sys
import datetime

ALICE_ADDR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
BOB_ADDR   = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
CAROL_ADDR = "0xcccccccccccccccccccccccccccccccccccccccc"
DAVE_ADDR  = "0xdddddddddddddddddddddddddddddddddddddddd"

EXCERPT_OK  = (
    "Nature's first green is gold,\n"
    "Her hardest hue to hold.\n"
    "Her early leaf's a flower;\n"
    "But only so an hour."
)
EXCERPT_BAD  = "buy milk, eggs, bread, and cheese"
EXCERPT_SHORT = "hi"

VERIFY_YES = json.dumps({"acceptable": True, "reasoning": "This is a suitable literary excerpt for a title contest."})
VERIFY_NO  = json.dumps({"acceptable": False, "reasoning": "This appears to be a grocery list, not a literary excerpt."})

# Judge response for a 4-player match (ranking + reasoning)
JUDGE_RESPONSE_4P = json.dumps({
    "ranking": [3, 1, 2, 4],
    "reasoning": [
        "Submission 3 captures the central tension elegantly without naming it",
        "Submission 1 is direct and resonant, but slightly literal",
        "Submission 2 is creative but slightly obscure",
        "Submission 4 did not submit a title",
    ],
})

# Judge response for a 2-player match
JUDGE_RESPONSE_2P = json.dumps({
    "ranking": [1, 2],
    "reasoning": [
        "Submission 1 is evocative and thematically apt",
        "Submission 2 is generic",
    ],
})

MOCK_EXCERPT_CHECK = "suitable for a title contest"    # substring in create_match verify prompt
MOCK_JUDGE         = "judging a title submission"      # substring in judge_match prompt


def _clear_known_contract():
    for mod in list(sys.modules.values()):
        for attr in ('__known_contact__', '__known_contract__'):
            if hasattr(mod, attr):
                try:
                    setattr(mod, attr, None)
                except Exception:
                    pass


def players(m):
    return json.loads(m.players_json) if m.players_json else []

def titles(m):
    return json.loads(m.titles_json) if m.titles_json and m.titles_json != "[]" else []

def ranking(m):
    return json.loads(m.ranking_json) if m.ranking_json and m.ranking_json != "[]" else []

def reasoning(m):
    return json.loads(m.judge_reasoning_json) if m.judge_reasoning_json and m.judge_reasoning_json != "[]" else []


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
    return direct_deploy("contracts/title_wars.py", registry.address)


@pytest.fixture
def open_match(contract, direct_vm):
    """Alice creates a valid match (WAITING), Bob joins."""
    direct_vm.mock_llm(MOCK_EXCERPT_CHECK, VERIFY_YES)
    direct_vm.sender = ALICE_ADDR
    match_id = contract.create_match(EXCERPT_OK, 4)
    direct_vm.sender = BOB_ADDR
    contract.join_match(match_id)
    return match_id


@pytest.fixture
def started_match(contract, direct_vm):
    """Alice creates, Bob joins, Alice starts. State = OPEN_FOR_SUBMISSIONS."""
    direct_vm.mock_llm(MOCK_EXCERPT_CHECK, VERIFY_YES)
    direct_vm.sender = ALICE_ADDR
    mid = contract.create_match(EXCERPT_OK, 4)
    direct_vm.sender = BOB_ADDR
    contract.join_match(mid)
    direct_vm.sender = ALICE_ADDR
    contract.start_match(mid)
    return mid


# ── create_match ──────────────────────────────────────────────────────────────

def test_create_match_accepted(contract, direct_vm):
    direct_vm.mock_llm(MOCK_EXCERPT_CHECK, VERIFY_YES)
    direct_vm.sender = ALICE_ADDR
    mid = contract.create_match(EXCERPT_OK, 4)
    m = contract.get_match(mid)
    assert int(m.state) == 0  # STATE_WAITING
    assert m.excerpt == EXCERPT_OK
    assert len(players(m)) == 1  # host auto-joined
    assert m.host_str == ALICE_ADDR.lower()
    assert titles(m) == [""]    # host's slot is empty until submission


def test_create_match_rejected(contract, direct_vm):
    direct_vm.mock_llm(MOCK_EXCERPT_CHECK, VERIFY_NO)
    direct_vm.sender = ALICE_ADDR
    mid = contract.create_match(EXCERPT_BAD, 4)
    m = contract.get_match(mid)
    assert int(m.state) == 1  # STATE_REJECTED
    assert len(m.rejection_reason) > 0


def test_create_match_too_short_reverts(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Excerpt must be"):
        contract.create_match(EXCERPT_SHORT, 4)


def test_create_match_too_long_reverts(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Excerpt must be"):
        contract.create_match("x" * 1501, 4)


def test_create_match_max_players_too_low(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("max_players must be at least 2"):
        contract.create_match(EXCERPT_OK, 1)


def test_create_match_max_players_too_high(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("max_players cannot exceed 50"):
        contract.create_match(EXCERPT_OK, 51)


def test_create_match_increments_ids(contract, direct_vm):
    direct_vm.mock_llm(MOCK_EXCERPT_CHECK, VERIFY_YES)
    direct_vm.sender = ALICE_ADDR
    id0 = contract.create_match(EXCERPT_OK, 2)
    id1 = contract.create_match(EXCERPT_OK, 2)
    assert int(id0) == 0
    assert int(id1) == 1


def test_create_match_appears_in_open_matches(contract, direct_vm):
    direct_vm.mock_llm(MOCK_EXCERPT_CHECK, VERIFY_YES)
    direct_vm.sender = ALICE_ADDR
    mid = contract.create_match(EXCERPT_OK, 4)
    open_ids = [int(x) for x in contract.get_open_matches(10)]
    assert int(mid) in open_ids


def test_create_rejected_not_in_open_matches(contract, direct_vm):
    direct_vm.mock_llm(MOCK_EXCERPT_CHECK, VERIFY_NO)
    direct_vm.sender = ALICE_ADDR
    mid = contract.create_match(EXCERPT_BAD, 4)
    open_ids = [int(x) for x in contract.get_open_matches(10)]
    assert int(mid) not in open_ids


# ── join_match ────────────────────────────────────────────────────────────────

def test_join_match_adds_player(contract, direct_vm, open_match):
    m = contract.get_match(open_match)
    assert len(players(m)) == 2
    assert players(m)[1].lower() == BOB_ADDR.lower()
    assert titles(m)[1] == ""  # Bob hasn't submitted yet


def test_join_match_full_rejected(contract, direct_vm):
    direct_vm.mock_llm(MOCK_EXCERPT_CHECK, VERIFY_YES)
    direct_vm.sender = ALICE_ADDR
    mid = contract.create_match(EXCERPT_OK, 2)
    direct_vm.sender = BOB_ADDR
    contract.join_match(mid)
    direct_vm.sender = CAROL_ADDR
    with direct_vm.expect_revert("Match is full"):
        contract.join_match(mid)


def test_join_match_duplicate_rejected(contract, direct_vm, open_match):
    direct_vm.sender = BOB_ADDR
    with direct_vm.expect_revert("Already joined this match"):
        contract.join_match(open_match)


def test_join_match_not_found(contract, direct_vm):
    direct_vm.sender = BOB_ADDR
    with direct_vm.expect_revert("Match not found"):
        contract.join_match(99)


def test_join_match_started_rejected(contract, direct_vm, started_match):
    direct_vm.sender = CAROL_ADDR
    with direct_vm.expect_revert("Match is not open for joining"):
        contract.join_match(started_match)


# ── start_match ───────────────────────────────────────────────────────────────

def test_start_match_sets_open_state(contract, direct_vm, open_match):
    direct_vm.sender = ALICE_ADDR
    contract.start_match(open_match)
    m = contract.get_match(open_match)
    assert int(m.state) == 2  # STATE_OPEN
    assert int(m.submission_deadline) > 0


def test_start_match_only_host(contract, direct_vm, open_match):
    direct_vm.sender = BOB_ADDR
    with direct_vm.expect_revert("Only the host can start the match"):
        contract.start_match(open_match)


def test_start_match_requires_2_players(contract, direct_vm):
    direct_vm.mock_llm(MOCK_EXCERPT_CHECK, VERIFY_YES)
    direct_vm.sender = ALICE_ADDR
    mid = contract.create_match(EXCERPT_OK, 4)
    with direct_vm.expect_revert("Need at least 2 players to start"):
        contract.start_match(mid)


def test_start_match_removes_from_open(contract, direct_vm, open_match):
    direct_vm.sender = ALICE_ADDR
    contract.start_match(open_match)
    open_ids = [int(x) for x in contract.get_open_matches(10)]
    assert int(open_match) not in open_ids


# ── submit_title ──────────────────────────────────────────────────────────────

def test_submit_title_stored(contract, direct_vm, started_match):
    direct_vm.sender = ALICE_ADDR
    contract.submit_title(started_match, "Gold's Brief Hour")
    m = contract.get_match(started_match)
    t = titles(m)
    alice_idx = next(i for i, p in enumerate(players(m)) if p.lower() == ALICE_ADDR.lower())
    assert t[alice_idx] == "Gold's Brief Hour"


def test_submit_title_update_before_deadline(contract, direct_vm, started_match):
    direct_vm.sender = ALICE_ADDR
    contract.submit_title(started_match, "First Title")
    contract.submit_title(started_match, "Better Title")
    m = contract.get_match(started_match)
    alice_idx = next(i for i, p in enumerate(players(m)) if p.lower() == ALICE_ADDR.lower())
    assert titles(m)[alice_idx] == "Better Title"


def test_submit_title_too_long_reverts(contract, direct_vm, started_match):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Title must be at most 100 characters"):
        contract.submit_title(started_match, "x" * 101)


def test_submit_title_not_player_reverts(contract, direct_vm, started_match):
    direct_vm.sender = CAROL_ADDR
    with direct_vm.expect_revert("You are not a player in this match"):
        contract.submit_title(started_match, "A title")


def test_submit_title_after_deadline_reverts(contract, direct_vm, started_match):
    direct_vm.warp(
        (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=3600)).isoformat()
    )
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Submission deadline has passed"):
        contract.submit_title(started_match, "Late Title")


def test_submit_title_wrong_state_reverts(contract, direct_vm, open_match):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Match is not accepting submissions"):
        contract.submit_title(open_match, "A title")


# ── judge_match ───────────────────────────────────────────────────────────────

def test_judge_match_all_submitted(contract, direct_vm, started_match):
    direct_vm.sender = ALICE_ADDR
    contract.submit_title(started_match, "Gold's Brief Hour")
    direct_vm.sender = BOB_ADDR
    contract.submit_title(started_match, "Nature Poem")
    direct_vm.mock_llm(MOCK_JUDGE, JUDGE_RESPONSE_2P)
    contract.judge_match(started_match)
    m = contract.get_match(started_match)
    assert int(m.state) == 4  # STATE_JUDGED
    assert len(ranking(m)) == 2
    assert len(reasoning(m)) == 2


def test_judge_match_deadline_passed_partial(contract, direct_vm, started_match):
    """Partial submissions: after deadline, judge_match should work."""
    direct_vm.sender = ALICE_ADDR
    contract.submit_title(started_match, "Gold's Brief Hour")
    # Bob did not submit
    direct_vm.warp(
        (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=3600)).isoformat()
    )
    direct_vm.mock_llm(MOCK_JUDGE, JUDGE_RESPONSE_2P)
    contract.judge_match(started_match)
    m = contract.get_match(started_match)
    assert int(m.state) == 4  # STATE_JUDGED
    # Both players in ranking
    assert len(ranking(m)) == 2


def test_judge_match_not_ready_reverts(contract, direct_vm, started_match):
    """Not all submitted and deadline not passed — should revert."""
    direct_vm.sender = ALICE_ADDR
    contract.submit_title(started_match, "Gold's Brief Hour")
    # Bob hasn't submitted, deadline not passed
    with direct_vm.expect_revert("Waiting for all players to submit or deadline to pass"):
        contract.judge_match(started_match)


def test_judge_match_winner_is_first_in_ranking(contract, direct_vm, started_match):
    direct_vm.sender = ALICE_ADDR
    contract.submit_title(started_match, "Gold's Brief Hour")
    direct_vm.sender = BOB_ADDR
    contract.submit_title(started_match, "Nature Poem")
    direct_vm.mock_llm(MOCK_JUDGE, JUDGE_RESPONSE_2P)
    contract.judge_match(started_match)
    m = contract.get_match(started_match)
    # JUDGE_RESPONSE_2P ranks player 1 (Alice) first
    assert ranking(m)[0].lower() == ALICE_ADDR.lower()


def test_judge_match_appears_in_judged_matches(contract, direct_vm, started_match):
    direct_vm.sender = ALICE_ADDR
    contract.submit_title(started_match, "Gold's Brief Hour")
    direct_vm.sender = BOB_ADDR
    contract.submit_title(started_match, "Nature Poem")
    direct_vm.mock_llm(MOCK_JUDGE, JUDGE_RESPONSE_2P)
    contract.judge_match(started_match)
    judged_ids = [int(x) for x in contract.get_judged_matches(10)]
    assert int(started_match) in judged_ids


def test_judge_match_wrong_state_reverts(contract, direct_vm, open_match):
    with direct_vm.expect_revert("Match is not in a judgeable state"):
        contract.judge_match(open_match)


# ── cancel_match ──────────────────────────────────────────────────────────────

def test_cancel_match_sets_cancelled(contract, direct_vm, open_match):
    direct_vm.sender = ALICE_ADDR
    contract.cancel_match(open_match)
    m = contract.get_match(open_match)
    assert int(m.state) == 5  # STATE_CANCELLED


def test_cancel_match_removes_from_open(contract, direct_vm, open_match):
    direct_vm.sender = ALICE_ADDR
    contract.cancel_match(open_match)
    open_ids = [int(x) for x in contract.get_open_matches(10)]
    assert int(open_match) not in open_ids


def test_cancel_match_only_host(contract, direct_vm, open_match):
    direct_vm.sender = BOB_ADDR
    with direct_vm.expect_revert("Only the host can cancel"):
        contract.cancel_match(open_match)


def test_cancel_match_requires_waiting(contract, direct_vm, started_match):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Can only cancel a match that is waiting for players"):
        contract.cancel_match(started_match)


# ── read methods ──────────────────────────────────────────────────────────────

def test_get_matches_for_player(contract, direct_vm, open_match):
    alice_ids = [int(x) for x in contract.get_matches_for_player(ALICE_ADDR)]
    bob_ids   = [int(x) for x in contract.get_matches_for_player(BOB_ADDR)]
    assert int(open_match) in alice_ids
    assert int(open_match) in bob_ids


def test_get_matches_for_player_not_in(contract, direct_vm, open_match):
    carol_ids = [int(x) for x in contract.get_matches_for_player(CAROL_ADDR)]
    assert int(open_match) not in carol_ids


def test_get_match_not_found(contract, direct_vm):
    m = contract.get_match(99)
    assert m is None


# ── record_match propagation ──────────────────────────────────────────────────

def test_record_match_propagation_to_registry(contract, direct_vm, started_match):
    """judge_match calls record_match; verify the match reaches JUDGED state."""
    direct_vm.sender = ALICE_ADDR
    contract.submit_title(started_match, "Gold's Brief Hour")
    direct_vm.sender = BOB_ADDR
    contract.submit_title(started_match, "Nature Poem")
    direct_vm.mock_llm(MOCK_JUDGE, JUDGE_RESPONSE_2P)
    contract.judge_match(started_match)
    m = contract.get_match(started_match)
    assert int(m.state) == 4
    assert len(ranking(m)) > 0
