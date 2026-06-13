import pytest
import json
import sys
import datetime

ALICE_ADDR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
BOB_ADDR   = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
CAROL_ADDR = "0xcccccccccccccccccccccccccccccccccccccccc"
DAVE_ADDR  = "0xdddddddddddddddddddddddddddddddddddddddd"

# Timestamps relative to "now" in tests
NOW     = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
IN_48H  = NOW + 48 * 3600
IN_7D   = NOW + 7 * 24 * 3600 - 1
TOO_SOON = 1                # Unix epoch — definitively in the past (MIN_HOURS=0, only past timestamps rejected)
TOO_FAR  = NOW + 8 * 24 * 3600  # 8 days — too far

VERIFY_YES = json.dumps({"verifiable": True,  "reasoning": "The question is answerable from public web sources."})
VERIFY_NO  = json.dumps({"verifiable": False, "reasoning": "This question cannot be answered from public web sources."})

RESOLVE_BINARY_TRUE = json.dumps({
    "answer": True,
    "source": "https://example.com/sports",
    "reasoning": "The home team won according to official box scores.",
})

RESOLVE_BINARY_FALSE = json.dumps({
    "answer": False,
    "source": "https://example.com/sports",
    "reasoning": "The away team won according to official box scores.",
})

RESOLVE_NUMERIC_45000 = json.dumps({
    "value": 45000,
    "unit": "USD",
    "source": "https://api.coingecko.com/...",
    "reasoning": "BTC/USD was 45000 at the resolution time per CoinGecko.",
})

RESOLVE_NUMERIC_46000 = json.dumps({
    "value": 46000,
    "unit": "USD",
    "source": "https://api.coingecko.com/...",
    "reasoning": "BTC/USD was 46000 at the resolution time per CoinGecko.",
})


# ── helpers ───────────────────────────────────────────────────────────────────

def players(m):
    return json.loads(m.players_json) if m.players_json else []

def predictions(m):
    return json.loads(m.predictions_json) if m.predictions_json else []

def sub_times(m):
    return json.loads(m.submission_times_json) if m.submission_times_json else []

def ranking(m):
    return json.loads(m.ranking_json) if m.ranking_json else []

def winner(m):
    r = ranking(m)
    return r[0] if r else None


def _clear_known_contract():
    for mod in list(sys.modules.values()):
        for attr in ('__known_contact__', '__known_contract__'):
            if hasattr(mod, attr):
                try:
                    setattr(mod, attr, None)
                except Exception:
                    pass


# ── fixtures ──────────────────────────────────────────────────────────────────

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
    return direct_deploy("contracts/predictions.py", registry.address)


@pytest.fixture
def registered(contract, registry, direct_vm):
    """Register all four test wallets."""
    for name, addr in [("Alice", ALICE_ADDR), ("Bob", BOB_ADDR), ("Carol", CAROL_ADDR), ("Dave", DAVE_ADDR)]:
        direct_vm.sender = addr
        registry.register_user(name)
    return contract


def _accepted_market(contract, direct_vm, *, binary=True, question=None, resolution=None):
    if question is None:
        question = "Will the home team win their next game?" if binary else "What will BTC price be in USD at resolution time?"
    if resolution is None:
        resolution = IN_48H
    market_type = 0 if binary else 1
    direct_vm.mock_llm(".*", VERIFY_YES)
    direct_vm.sender = ALICE_ADDR
    return contract.create_market(question, market_type, resolution)


# ── create_market ─────────────────────────────────────────────────────────────

def test_create_binary_market_accepted(contract, direct_vm):
    market_id = _accepted_market(contract, direct_vm, binary=True)
    m = contract.get_market(market_id)
    assert m is not None
    assert int(m.state) == 0  # STATE_OPEN
    assert int(m.market_type) == 0  # BINARY


def test_create_numeric_market_accepted(contract, direct_vm):
    market_id = _accepted_market(contract, direct_vm, binary=False)
    m = contract.get_market(market_id)
    assert int(m.state) == 0  # STATE_OPEN
    assert int(m.market_type) == 1  # NUMERIC


def test_create_market_rejected_by_ai(contract, direct_vm):
    direct_vm.mock_llm(".*", VERIFY_NO)
    direct_vm.sender = ALICE_ADDR
    market_id = contract.create_market("Will the moon turn purple tomorrow?", 0, IN_48H)
    m = contract.get_market(market_id)
    assert int(m.state) == 2  # STATE_REJECTED
    assert len(m.rejection_reason) > 0


def test_create_market_stores_rejection_reason(contract, direct_vm):
    direct_vm.mock_llm(".*", VERIFY_NO)
    direct_vm.sender = ALICE_ADDR
    market_id = contract.create_market("Nonsense question?", 0, IN_48H)
    m = contract.get_market(market_id)
    assert len(m.rejection_reason) > 0


def test_create_market_too_soon_rejected(contract, direct_vm):
    with direct_vm.expect_revert("Resolution datetime must be at least 24 hours from now"):
        contract.create_market("Valid question?", 0, TOO_SOON)


def test_create_market_too_far_rejected(contract, direct_vm):
    with direct_vm.expect_revert("Resolution datetime must be at most 7 days from now"):
        contract.create_market("Valid question?", 0, TOO_FAR)


def test_create_market_question_too_long_rejected(contract, direct_vm):
    with direct_vm.expect_revert("Question exceeds 300 characters"):
        contract.create_market("x" * 301, 0, IN_48H)


def test_create_market_question_300_chars_ok(contract, direct_vm):
    direct_vm.mock_llm(".*", VERIFY_YES)
    direct_vm.sender = ALICE_ADDR
    market_id = contract.create_market("x" * 300, 0, IN_48H)
    m = contract.get_market(market_id)
    assert m is not None


def test_create_market_invalid_type_rejected(contract, direct_vm):
    with direct_vm.expect_revert("Invalid market_type"):
        contract.create_market("Valid question?", 5, IN_48H)


def test_create_market_incrementing_ids(contract, direct_vm):
    id0 = _accepted_market(contract, direct_vm, binary=True)
    id1 = _accepted_market(contract, direct_vm, binary=False)
    assert int(id0) == 0
    assert int(id1) == 1


def test_create_market_appears_in_open_list(contract, direct_vm):
    market_id = _accepted_market(contract, direct_vm)
    open_ids = [int(x) for x in contract.get_open_markets(10)]
    assert int(market_id) in open_ids


def test_rejected_market_not_in_open_list(contract, direct_vm):
    direct_vm.mock_llm(".*", VERIFY_NO)
    direct_vm.sender = ALICE_ADDR
    market_id = contract.create_market("Nonsense?", 0, IN_48H)
    open_ids = [int(x) for x in contract.get_open_markets(10)]
    assert int(market_id) not in open_ids


# ── join_and_predict_binary ────────────────────────────────────────────────────

def test_join_binary_adds_player(contract, direct_vm):
    market_id = _accepted_market(contract, direct_vm, binary=True)
    direct_vm.sender = BOB_ADDR
    contract.join_and_predict_binary(market_id, True)
    m = contract.get_market(market_id)
    pl = players(m)
    assert len(pl) == 1
    assert pl[0].lower() == BOB_ADDR.lower()


def test_join_binary_stores_prediction(contract, direct_vm):
    market_id = _accepted_market(contract, direct_vm, binary=True)
    direct_vm.sender = BOB_ADDR
    contract.join_and_predict_binary(market_id, False)
    m = contract.get_market(market_id)
    assert predictions(m)[0] == False


def test_join_binary_update_prediction(contract, direct_vm):
    market_id = _accepted_market(contract, direct_vm, binary=True)
    direct_vm.sender = BOB_ADDR
    contract.join_and_predict_binary(market_id, True)
    contract.join_and_predict_binary(market_id, False)
    m = contract.get_market(market_id)
    assert predictions(m)[0] == False
    assert len(players(m)) == 1  # still 1 player, not 2


def test_join_binary_wrong_type_rejected(contract, direct_vm):
    market_id = _accepted_market(contract, direct_vm, binary=False)
    direct_vm.sender = BOB_ADDR
    with direct_vm.expect_revert("Market is not binary"):
        contract.join_and_predict_binary(market_id, True)


def test_join_binary_rejected_market_rejected(contract, direct_vm):
    direct_vm.mock_llm(".*", VERIFY_NO)
    direct_vm.sender = ALICE_ADDR
    market_id = contract.create_market("Nonsense?", 0, IN_48H)
    direct_vm.sender = BOB_ADDR
    with direct_vm.expect_revert("Market is not open"):
        contract.join_and_predict_binary(market_id, True)


# ── join_and_predict_numeric ──────────────────────────────────────────────────

def test_join_numeric_adds_player(contract, direct_vm):
    market_id = _accepted_market(contract, direct_vm, binary=False)
    direct_vm.sender = BOB_ADDR
    contract.join_and_predict_numeric(market_id, "45000.0")
    m = contract.get_market(market_id)
    assert len(players(m)) == 1


def test_join_numeric_stores_prediction(contract, direct_vm):
    market_id = _accepted_market(contract, direct_vm, binary=False)
    direct_vm.sender = BOB_ADDR
    contract.join_and_predict_numeric(market_id, "45000.0")
    m = contract.get_market(market_id)
    assert abs(predictions(m)[0] - 45000.0) < 0.01


def test_join_numeric_update_prediction(contract, direct_vm):
    market_id = _accepted_market(contract, direct_vm, binary=False)
    direct_vm.sender = BOB_ADDR
    contract.join_and_predict_numeric(market_id, "45000.0")
    contract.join_and_predict_numeric(market_id, "46000.0")
    m = contract.get_market(market_id)
    assert abs(predictions(m)[0] - 46000.0) < 0.01
    assert len(players(m)) == 1


def test_join_numeric_wrong_type_rejected(contract, direct_vm):
    market_id = _accepted_market(contract, direct_vm, binary=True)
    direct_vm.sender = BOB_ADDR
    with direct_vm.expect_revert("Market is not numeric"):
        contract.join_and_predict_numeric(market_id, "100.0")


# ── predict after deadline passes ─────────────────────────────────────────────

@pytest.fixture
def expired_open_binary(contract, direct_vm):
    """Binary market where deadline has passed but not yet resolved."""
    market_id = _accepted_market(contract, direct_vm, binary=True)
    direct_vm.clear_mocks()
    direct_vm.warp((datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3)).isoformat())
    return market_id


def test_predict_after_deadline_rejected(contract, direct_vm, expired_open_binary):
    direct_vm.sender = BOB_ADDR
    with direct_vm.expect_revert("Prediction deadline has passed"):
        contract.join_and_predict_binary(expired_open_binary, True)


# ── resolve_market binary ─────────────────────────────────────────────────────

@pytest.fixture
def binary_ready_to_resolve(contract, registry, direct_vm):
    """Binary market with 3 players, deadline expired, all predicted."""
    for name, addr in [("Alice", ALICE_ADDR), ("Bob", BOB_ADDR), ("Carol", CAROL_ADDR)]:
        direct_vm.sender = addr
        registry.register_user(name)

    market_id = _accepted_market(contract, direct_vm, binary=True)
    direct_vm.clear_mocks()  # remove VERIFY_YES so tests control their own resolve mock

    direct_vm.sender = ALICE_ADDR
    contract.join_and_predict_binary(market_id, True)
    direct_vm.sender = BOB_ADDR
    contract.join_and_predict_binary(market_id, False)
    direct_vm.sender = CAROL_ADDR
    contract.join_and_predict_binary(market_id, True)

    direct_vm.warp((datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3)).isoformat())
    return market_id


def test_resolve_binary_sets_resolved_state(contract, direct_vm, binary_ready_to_resolve):
    direct_vm.mock_llm(".*", RESOLVE_BINARY_TRUE)
    direct_vm.sender = BOB_ADDR
    contract.resolve_market(binary_ready_to_resolve)
    m = contract.get_market(binary_ready_to_resolve)
    assert int(m.state) == 1  # STATE_RESOLVED


def test_resolve_binary_correct_answer(contract, direct_vm, binary_ready_to_resolve):
    direct_vm.mock_llm(".*", RESOLVE_BINARY_TRUE)
    direct_vm.sender = BOB_ADDR
    contract.resolve_market(binary_ready_to_resolve)
    m = contract.get_market(binary_ready_to_resolve)
    assert m.actual_answer == "true"


def test_resolve_binary_ranking_correct_first(contract, direct_vm, binary_ready_to_resolve):
    """Alice (True) and Carol (True) predicted correctly; Bob (False) is wrong."""
    direct_vm.mock_llm(".*", RESOLVE_BINARY_TRUE)
    direct_vm.sender = BOB_ADDR
    contract.resolve_market(binary_ready_to_resolve)
    m = contract.get_market(binary_ready_to_resolve)
    r = ranking(m)
    assert len(r) == 3
    # Alice (index 0) and Carol (index 2) should be in positions 0 and 1
    top2 = {r[0].lower(), r[1].lower()}
    assert ALICE_ADDR.lower() in top2
    assert CAROL_ADDR.lower() in top2
    assert r[2].lower() == BOB_ADDR.lower()


def test_resolve_binary_tiebreak_by_submission_time(contract, direct_vm, binary_ready_to_resolve):
    """Alice joined first and Carol joined second; both correct — Alice wins tiebreak."""
    direct_vm.mock_llm(".*", RESOLVE_BINARY_TRUE)
    direct_vm.sender = ALICE_ADDR
    contract.resolve_market(binary_ready_to_resolve)
    m = contract.get_market(binary_ready_to_resolve)
    r = ranking(m)
    assert r[0].lower() == ALICE_ADDR.lower()


def test_resolve_binary_stores_source_and_reasoning(contract, direct_vm, binary_ready_to_resolve):
    direct_vm.mock_llm(".*", RESOLVE_BINARY_TRUE)
    contract.resolve_market(binary_ready_to_resolve)
    m = contract.get_market(binary_ready_to_resolve)
    assert len(m.actual_answer_source) > 0
    assert len(m.resolution_reasoning) > 0


def test_resolve_binary_wrong_answer_all_lose(contract, direct_vm, binary_ready_to_resolve):
    """If actual=False: Bob (False) wins, Alice/Carol (True) lose."""
    direct_vm.mock_llm(".*", RESOLVE_BINARY_FALSE)
    contract.resolve_market(binary_ready_to_resolve)
    m = contract.get_market(binary_ready_to_resolve)
    r = ranking(m)
    assert r[0].lower() == BOB_ADDR.lower()


def test_resolve_binary_appears_in_resolved_list(contract, direct_vm, binary_ready_to_resolve):
    direct_vm.mock_llm(".*", RESOLVE_BINARY_TRUE)
    contract.resolve_market(binary_ready_to_resolve)
    resolved_ids = [int(x) for x in contract.get_resolved_markets(10)]
    assert int(binary_ready_to_resolve) in resolved_ids


def test_resolve_binary_removed_from_open_list(contract, direct_vm, binary_ready_to_resolve):
    direct_vm.mock_llm(".*", RESOLVE_BINARY_TRUE)
    contract.resolve_market(binary_ready_to_resolve)
    open_ids = [int(x) for x in contract.get_open_markets(10)]
    assert int(binary_ready_to_resolve) not in open_ids


def test_cannot_resolve_twice(contract, direct_vm, binary_ready_to_resolve):
    direct_vm.mock_llm(".*", RESOLVE_BINARY_TRUE)
    contract.resolve_market(binary_ready_to_resolve)
    with direct_vm.expect_revert("Market is not open or already resolved"):
        contract.resolve_market(binary_ready_to_resolve)


def test_cannot_resolve_before_deadline(contract, direct_vm):
    market_id = _accepted_market(contract, direct_vm, binary=True)
    with direct_vm.expect_revert("Resolution datetime has not arrived yet"):
        contract.resolve_market(market_id)


def test_cannot_predict_after_resolve(contract, direct_vm, binary_ready_to_resolve):
    direct_vm.mock_llm(".*", RESOLVE_BINARY_TRUE)
    contract.resolve_market(binary_ready_to_resolve)
    direct_vm.sender = DAVE_ADDR
    with direct_vm.expect_revert("Market is not open"):
        contract.join_and_predict_binary(binary_ready_to_resolve, True)


def test_resolve_records_stats(contract, registry, direct_vm, binary_ready_to_resolve):
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
    direct_vm.mock_llm(".*", RESOLVE_BINARY_TRUE)
    contract.resolve_market(binary_ready_to_resolve)
    direct_vm._gl_call_hook = None

    alice = registry.get_profile(ALICE_ADDR)
    bob   = registry.get_profile(BOB_ADDR)
    carol = registry.get_profile(CAROL_ADDR)
    assert int(alice.total_matches) + int(bob.total_matches) + int(carol.total_matches) == 3
    assert int(alice.total_wins) + int(bob.total_wins) + int(carol.total_wins) == 1


# ── resolve_market numeric ────────────────────────────────────────────────────

@pytest.fixture
def numeric_ready_to_resolve(contract, registry, direct_vm):
    """Numeric market with 3 players; Alice=45000, Bob=46000, Carol=44000. Actual=45000."""
    for name, addr in [("Alice", ALICE_ADDR), ("Bob", BOB_ADDR), ("Carol", CAROL_ADDR)]:
        direct_vm.sender = addr
        registry.register_user(name)

    market_id = _accepted_market(contract, direct_vm, binary=False)
    direct_vm.clear_mocks()  # remove VERIFY_YES so tests control their own resolve mock

    direct_vm.sender = ALICE_ADDR
    contract.join_and_predict_numeric(market_id, "45000.0")
    direct_vm.sender = BOB_ADDR
    contract.join_and_predict_numeric(market_id, "46000.0")
    direct_vm.sender = CAROL_ADDR
    contract.join_and_predict_numeric(market_id, "44000.0")

    direct_vm.warp((datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3)).isoformat())
    return market_id


def test_resolve_numeric_sets_resolved_state(contract, direct_vm, numeric_ready_to_resolve):
    direct_vm.mock_llm(".*", RESOLVE_NUMERIC_45000)
    contract.resolve_market(numeric_ready_to_resolve)
    m = contract.get_market(numeric_ready_to_resolve)
    assert int(m.state) == 1  # STATE_RESOLVED


def test_resolve_numeric_correct_answer_stored(contract, direct_vm, numeric_ready_to_resolve):
    direct_vm.mock_llm(".*", RESOLVE_NUMERIC_45000)
    contract.resolve_market(numeric_ready_to_resolve)
    m = contract.get_market(numeric_ready_to_resolve)
    assert abs(float(m.actual_answer) - 45000.0) < 0.01


def test_resolve_numeric_ranking_by_distance(contract, direct_vm, numeric_ready_to_resolve):
    """Actual=45000: Alice (45000, dist=0) wins, Carol (44000, dist=1000) 2nd, Bob (46000, dist=1000) 3rd."""
    direct_vm.mock_llm(".*", RESOLVE_NUMERIC_45000)
    contract.resolve_market(numeric_ready_to_resolve)
    m = contract.get_market(numeric_ready_to_resolve)
    r = ranking(m)
    assert len(r) == 3
    assert r[0].lower() == ALICE_ADDR.lower()


def test_resolve_numeric_different_answer_changes_ranking(contract, direct_vm, numeric_ready_to_resolve):
    """Actual=46000: Bob (46000, dist=0) wins."""
    direct_vm.mock_llm(".*", RESOLVE_NUMERIC_46000)
    contract.resolve_market(numeric_ready_to_resolve)
    m = contract.get_market(numeric_ready_to_resolve)
    r = ranking(m)
    assert r[0].lower() == BOB_ADDR.lower()


def test_resolve_numeric_stores_source_and_reasoning(contract, direct_vm, numeric_ready_to_resolve):
    direct_vm.mock_llm(".*", RESOLVE_NUMERIC_45000)
    contract.resolve_market(numeric_ready_to_resolve)
    m = contract.get_market(numeric_ready_to_resolve)
    assert "coingecko" in m.actual_answer_source.lower()
    assert len(m.resolution_reasoning) > 0


# ── cancel_market ─────────────────────────────────────────────────────────────

def test_cancel_market_empty(contract, direct_vm):
    market_id = _accepted_market(contract, direct_vm)
    direct_vm.sender = ALICE_ADDR
    contract.cancel_market(market_id)
    m = contract.get_market(market_id)
    assert int(m.state) == 3  # STATE_CANCELLED


def test_cancel_market_removes_from_open_list(contract, direct_vm):
    market_id = _accepted_market(contract, direct_vm)
    direct_vm.sender = ALICE_ADDR
    contract.cancel_market(market_id)
    open_ids = [int(x) for x in contract.get_open_markets(10)]
    assert int(market_id) not in open_ids


def test_cancel_market_non_creator_rejected(contract, direct_vm):
    market_id = _accepted_market(contract, direct_vm)
    direct_vm.sender = BOB_ADDR
    with direct_vm.expect_revert("Only the creator can cancel this market"):
        contract.cancel_market(market_id)


def test_cancel_market_with_players_rejected(contract, direct_vm):
    market_id = _accepted_market(contract, direct_vm, binary=True)
    direct_vm.sender = BOB_ADDR
    contract.join_and_predict_binary(market_id, True)
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Cannot cancel a market that has players"):
        contract.cancel_market(market_id)


def test_cancel_already_resolved_rejected(contract, direct_vm):
    market_id = _accepted_market(contract, direct_vm, binary=True)
    direct_vm.clear_mocks()
    direct_vm.sender = BOB_ADDR
    contract.join_and_predict_binary(market_id, True)
    direct_vm.warp((datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3)).isoformat())
    direct_vm.mock_llm(".*", RESOLVE_BINARY_TRUE)
    contract.resolve_market(market_id)
    with direct_vm.expect_revert("Market is not open"):
        direct_vm.sender = ALICE_ADDR
        contract.cancel_market(market_id)


# ── get_open_markets / get_resolved_markets / get_markets_for_player ──────────

def test_get_open_markets_sorted_newest_first(contract, direct_vm):
    id0 = _accepted_market(contract, direct_vm)
    id1 = _accepted_market(contract, direct_vm)
    open_ids = [int(x) for x in contract.get_open_markets(10)]
    # newest first
    assert open_ids.index(int(id1)) < open_ids.index(int(id0))


def test_get_open_markets_respects_limit(contract, direct_vm):
    for _ in range(5):
        _accepted_market(contract, direct_vm)
    open_ids = contract.get_open_markets(3)
    assert len(open_ids) == 3


def test_get_markets_for_player(contract, direct_vm):
    id0 = _accepted_market(contract, direct_vm, binary=True)
    id1 = _accepted_market(contract, direct_vm, binary=False)

    direct_vm.sender = BOB_ADDR
    contract.join_and_predict_binary(id0, True)

    bob_ids = [int(x) for x in contract.get_markets_for_player(BOB_ADDR)]
    alice_ids = [int(x) for x in contract.get_markets_for_player(ALICE_ADDR)]

    assert int(id0) in bob_ids
    assert int(id1) not in bob_ids
    # Alice is not a player in any market (she's the creator but didn't join)
    assert int(id0) not in alice_ids


def test_get_markets_for_player_after_join(contract, direct_vm):
    market_id = _accepted_market(contract, direct_vm, binary=True)
    direct_vm.sender = CAROL_ADDR
    contract.join_and_predict_binary(market_id, False)
    carol_ids = [int(x) for x in contract.get_markets_for_player(CAROL_ADDR)]
    assert int(market_id) in carol_ids


# ── daily AI content generation ───────────────────────────────────────────────

DAILY_MARKETS_RESPONSE = json.dumps({
    "markets": [
        {"question": "Will the S&P 500 close above 5,500 tomorrow?", "market_type": "binary", "resolution_hours_from_now": 24},
        {"question": "Will Bitcoin close above $70,000 tomorrow?", "market_type": "binary", "resolution_hours_from_now": 24},
        {"question": "Will the Fed announce a rate change this week?", "market_type": "binary", "resolution_hours_from_now": 48},
        {"question": "What will be the closing price of NVDA tomorrow?", "market_type": "numeric", "resolution_hours_from_now": 30, "unit": "USD"},
        {"question": "What will be the BTC/USD price at 00:00 UTC in 48 hours?", "market_type": "numeric", "resolution_hours_from_now": 48, "unit": "USD"},
    ]
})


def test_generate_daily_content_first_time_succeeds(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    direct_vm.mock_llm(".*", DAILY_MARKETS_RESPONSE)
    contract.generate_daily_content_if_due()
    ids = [int(x) for x in contract.get_daily_match_ids()]
    assert len(ids) == 5
    for mid in ids:
        m = contract.get_market(mid)
        assert m is not None
        assert m.is_daily_generated is True


def test_generate_daily_content_second_call_same_day_reverts(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    direct_vm.mock_llm(".*", DAILY_MARKETS_RESPONSE)
    contract.generate_daily_content_if_due()
    with direct_vm.expect_revert("Daily content already generated today"):
        contract.generate_daily_content_if_due()


def test_generate_daily_content_next_day_succeeds(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    direct_vm.mock_llm(".*", DAILY_MARKETS_RESPONSE)
    contract.generate_daily_content_if_due()
    direct_vm.warp((datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=25)).isoformat())
    contract.generate_daily_content_if_due()
    ids = [int(x) for x in contract.get_daily_match_ids()]
    assert len(ids) == 5


def test_daily_markets_have_correct_flag(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    direct_vm.mock_llm(".*", VERIFY_YES)
    regular_id = contract.create_market("Will it rain today?", 0, IN_48H)
    m_regular = contract.get_market(regular_id)
    assert m_regular.is_daily_generated is False
    direct_vm.mock_llm(".*", DAILY_MARKETS_RESPONSE)
    contract.generate_daily_content_if_due()
    for mid in [int(x) for x in contract.get_daily_match_ids()]:
        m = contract.get_market(mid)
        assert m.is_daily_generated is True
