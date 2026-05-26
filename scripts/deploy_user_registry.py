"""
Deploy contracts/user_registry.py to GenLayer localnet and print the contract address.

Usage:
    python scripts/deploy_user_registry.py [--rpc <url>] [--private-key <hex>]

Defaults to localnet at http://localhost:4000/api using Hardhat account #0.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Deploy UserRegistry contract")
    parser.add_argument("--rpc", default="http://localhost:4000/api")
    parser.add_argument(
        "--private-key",
        default="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    )
    args = parser.parse_args()

    contract_path = Path(__file__).parent.parent / "contracts" / "user_registry.py"
    if not contract_path.exists():
        print(f"Error: contract not found at {contract_path}", file=sys.stderr)
        sys.exit(1)

    cmd = [
        "genlayer",
        "deploy",
        "--contract",
        str(contract_path),
        "--rpc",
        args.rpc,
    ]

    print(f"Deploying {contract_path.name} to {args.rpc} ...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    # Parse contract address from output
    for line in (result.stdout + result.stderr).splitlines():
        if "Contract Address" in line:
            parts = line.split(":")
            if len(parts) >= 2:
                addr = parts[-1].strip().strip("'\"")
                print(f"Contract deployed at: {addr}")
                return

    print("Deploy output:")
    print(result.stdout)
    if result.returncode != 0:
        print("Stderr:", result.stderr, file=sys.stderr)
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()
