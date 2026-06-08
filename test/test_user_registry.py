import pytest

ALICE_ADDR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
BOB_ADDR   = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
CAROL_ADDR = "0xcccccccccccccccccccccccccccccccccccccccc"
DAVE_ADDR  = "0xdddddddddddddddddddddddddddddddddddddddd"


@pytest.fixture
def contract(direct_deploy):
    return direct_deploy("contracts/user_registry.py")


# ---------------------------------------------------------------------------
# Successful registration + profile readback
# ---------------------------------------------------------------------------

def test_successful_registration_and_readback(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    profile = contract.get_profile(ALICE_ADDR)
    assert profile is not None
    assert profile.username == "Alice"
    assert profile.total_matches == 0
    assert profile.total_wins == 0


# ---------------------------------------------------------------------------
# Duplicate address rejected
# ---------------------------------------------------------------------------

def test_duplicate_address_rejected(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    with direct_vm.expect_revert("Address already registered"):
        contract.register_user("AliasName")


# ---------------------------------------------------------------------------
# Duplicate username rejected (case-insensitive)
# ---------------------------------------------------------------------------

def test_duplicate_username_case_insensitive(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    direct_vm.sender = BOB_ADDR
    with direct_vm.expect_revert("Username already taken"):
        contract.register_user("alice")


def test_duplicate_username_same_case(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    direct_vm.sender = BOB_ADDR
    with direct_vm.expect_revert("Username already taken"):
        contract.register_user("Alice")


# ---------------------------------------------------------------------------
# Invalid usernames rejected
# ---------------------------------------------------------------------------

def test_username_too_short(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Username must be between 3 and 20 characters"):
        contract.register_user("ab")


def test_username_too_long(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Username must be between 3 and 20 characters"):
        contract.register_user("a" * 21)


def test_username_has_space(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Username may only contain letters, numbers, and underscores"):
        contract.register_user("alice bob")


def test_username_has_dash(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Username may only contain letters, numbers, and underscores"):
        contract.register_user("alice-bob")


def test_username_has_special_char(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Username may only contain letters, numbers, and underscores"):
        contract.register_user("alice@bob")


# ---------------------------------------------------------------------------
# update_username — works and frees old name
# ---------------------------------------------------------------------------

def test_update_username_works_and_frees_old_name(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    contract.update_username("AliceNew")

    profile = contract.get_profile(ALICE_ADDR)
    assert profile.username == "AliceNew"

    # old name "alice" is now free — bob can claim it
    direct_vm.sender = BOB_ADDR
    contract.register_user("Alice")
    bob_profile = contract.get_profile(BOB_ADDR)
    assert bob_profile.username == "Alice"


def test_update_username_rejected_if_not_registered(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Address not registered"):
        contract.update_username("NewName")


def test_update_username_rejected_if_name_taken(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    direct_vm.sender = BOB_ADDR
    contract.register_user("Bob")

    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Username already taken"):
        contract.update_username("bob")


# ---------------------------------------------------------------------------
# record_match — correctly increments counters
# ---------------------------------------------------------------------------

def test_record_match_win(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    contract.record_match(ALICE_ADDR, True)

    profile = contract.get_profile(ALICE_ADDR)
    assert profile.total_matches == 1
    assert profile.total_wins == 1


def test_record_match_loss(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    contract.record_match(ALICE_ADDR, False)

    profile = contract.get_profile(ALICE_ADDR)
    assert profile.total_matches == 1
    assert profile.total_wins == 0


def test_record_match_multiple(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    contract.record_match(ALICE_ADDR, True)
    contract.record_match(ALICE_ADDR, False)
    contract.record_match(ALICE_ADDR, True)

    profile = contract.get_profile(ALICE_ADDR)
    assert profile.total_matches == 3
    assert profile.total_wins == 2


def test_record_match_unregistered_player(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    with direct_vm.expect_revert("Player not registered"):
        contract.record_match(BOB_ADDR, True)


# ---------------------------------------------------------------------------
# get_profile returns None for unregistered address
# ---------------------------------------------------------------------------

def test_get_profile_none_for_unregistered(contract, direct_vm):
    result = contract.get_profile(ALICE_ADDR)
    assert result is None


# ---------------------------------------------------------------------------
# address_of and is_username_taken
# ---------------------------------------------------------------------------

def test_address_of(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    addr = contract.address_of("Alice")
    assert str(addr).lower() == ALICE_ADDR.lower()

    addr_lower = contract.address_of("alice")
    assert str(addr_lower).lower() == ALICE_ADDR.lower()


def test_address_of_unknown_returns_none(contract, direct_vm):
    assert contract.address_of("nobody") is None


def test_is_username_taken(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    assert contract.is_username_taken("Alice") is True
    assert contract.is_username_taken("alice") is True
    assert contract.is_username_taken("Bob") is False


# ---------------------------------------------------------------------------
# record_match_batch — batch stats update
# ---------------------------------------------------------------------------

def test_record_match_batch_four_players(contract, direct_vm):
    for addr, name in [(ALICE_ADDR, "Alice"), (BOB_ADDR, "Bob"),
                       (CAROL_ADDR, "Carol"), (DAVE_ADDR, "Dave")]:
        direct_vm.sender = addr
        contract.register_user(name)

    contract.record_match_batch([
        {"player": ALICE_ADDR, "rank": 1, "total_players": 4},
        {"player": BOB_ADDR,   "rank": 2, "total_players": 4},
        {"player": CAROL_ADDR, "rank": 3, "total_players": 4},
        {"player": DAVE_ADDR,  "rank": 4, "total_players": 4},
    ])

    alice = contract.get_profile(ALICE_ADDR)
    bob   = contract.get_profile(BOB_ADDR)
    carol = contract.get_profile(CAROL_ADDR)
    dave  = contract.get_profile(DAVE_ADDR)

    assert alice.total_matches == 1 and alice.total_wins == 1
    assert bob.total_matches   == 1 and bob.total_wins   == 0
    assert carol.total_matches == 1 and carol.total_wins == 0
    assert dave.total_matches  == 1 and dave.total_wins  == 0


def test_record_match_batch_single_entry_same_as_record_match(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    contract.record_match_batch([{"player": ALICE_ADDR, "rank": 1, "total_players": 1}])

    profile = contract.get_profile(ALICE_ADDR)
    assert profile.total_matches == 1
    assert profile.total_wins == 1


def test_record_match_batch_empty_list_is_noop(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")

    contract.record_match_batch([])

    profile = contract.get_profile(ALICE_ADDR)
    assert profile.total_matches == 0
    assert profile.total_wins == 0


def test_record_match_batch_fifty_players(contract, direct_vm):
    addrs = [f"0x{str(i).zfill(40)}" for i in range(1, 51)]
    for i, addr in enumerate(addrs):
        direct_vm.sender = addr
        contract.register_user(f"player{i+1}")

    entries = [{"player": addr, "rank": i + 1, "total_players": 50}
               for i, addr in enumerate(addrs)]
    contract.record_match_batch(entries)

    winner = contract.get_profile(addrs[0])
    last   = contract.get_profile(addrs[49])
    assert winner.total_matches == 1 and winner.total_wins == 1
    assert last.total_matches   == 1 and last.total_wins   == 0


def test_record_match_batch_counters_accumulate(contract, direct_vm):
    direct_vm.sender = ALICE_ADDR
    contract.register_user("Alice")
    direct_vm.sender = BOB_ADDR
    contract.register_user("Bob")

    contract.record_match_batch([
        {"player": ALICE_ADDR, "rank": 1, "total_players": 2},
        {"player": BOB_ADDR,   "rank": 2, "total_players": 2},
    ])
    contract.record_match_batch([
        {"player": BOB_ADDR,   "rank": 1, "total_players": 2},
        {"player": ALICE_ADDR, "rank": 2, "total_players": 2},
    ])

    alice = contract.get_profile(ALICE_ADDR)
    bob   = contract.get_profile(BOB_ADDR)
    assert alice.total_matches == 2 and alice.total_wins == 1
    assert bob.total_matches   == 2 and bob.total_wins   == 1
