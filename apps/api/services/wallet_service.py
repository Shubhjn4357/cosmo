from __future__ import annotations
import os
import json
from pathlib import Path
from typing import Optional, Dict, Any, TYPE_CHECKING, TypedDict

try:
    from web3 import Web3
    import eth_account
    from eth_account import Account
    HAS_WEB3 = True
except ImportError:
    HAS_WEB3 = False
    Web3 = None
    Account = None
    logger_warning = True
else:
    logger_warning = False

from loguru import logger

if TYPE_CHECKING:
    try:
        from eth_account.signers.local import LocalAccount
    except ImportError:
        LocalAccount = Any

class WalletStatus(TypedDict):
    address: str
    balance: float
    network: str
    connected: bool
    has_private_key: bool
    controller_address: Optional[str]

from utils.app_paths import get_data_root

# Wallet directory
WALLET_DIR = get_data_root() / "wallet"
WALLET_FILE = WALLET_DIR / "agent_wallet.json"
BASE_RPC_URL = os.getenv("BASE_RPC_URL", "https://mainnet.base.org")

class WalletService:
    def __init__(self, rpc_url: str = BASE_RPC_URL):
        self.rpc_url = rpc_url
        self.enabled = HAS_WEB3
        self._account = None
        self._controller_address: Optional[str] = None
        
        if not self.enabled:
            logger.warning("Blockchain features DISABLED: 'web3' or 'eth-account' not installed")
            return

        try:
            self.w3 = Web3(Web3.HTTPProvider(rpc_url))
            # Ensure directory exists
            WALLET_DIR.mkdir(parents=True, exist_ok=True)
            # Initialize or load
            self._load_or_create_wallet()
        except Exception as e:
            logger.error(f"Failed to initialize WalletService: {e}")
            self.enabled = False

    def set_controller(self, address: str) -> bool:
        """Sets the authorized controller address (e.g. from Admin Metamask)."""
        if not self.enabled or not self.w3:
            return False
            
        try:
            if self.w3.is_address(address):
                self._controller_address = self.w3.to_checksum_address(address)
                # Persist this in the wallet file
                self._save_wallet()
                logger.info(f"Controller address linked: {self._controller_address}")
                return True
        except Exception:
            pass
        return False

    def _save_wallet(self) -> None:
        """Persists wallet data including linked controller."""
        if not self._account or not self.enabled:
            return
        wallet_data = {
            "address": self._account.address,
            "private_key": self._account.key.hex(),
            "controller_address": self._controller_address
        }
        try:
            WALLET_FILE.write_text(json.dumps(wallet_data, indent=4))
            try:
                os.chmod(WALLET_FILE, 0o600)
            except Exception:
                pass
        except Exception as e:
            logger.error(f"Failed to save wallet: {e}")

    def _load_or_create_wallet(self) -> None:
        """Loads a wallet from disk or creates a new one if missing."""
        if not WALLET_FILE.exists():
            self._create_new_wallet()
        else:
            self._load_existing_wallet()

    def _load_existing_wallet(self) -> None:
        if not self.enabled or not Account:
            return
        try:
            data = json.loads(WALLET_FILE.read_text(encoding="utf-8"))
            private_key = data.get("private_key")
            if private_key:
                self._account = Account.from_key(private_key)
                self._controller_address = data.get("controller_address")
                logger.info(f"Loaded existing agent wallet: {self._account.address}")
        except Exception as e:
            logger.error(f"Failed to load wallet from {WALLET_FILE}: {e}")
            self._create_new_wallet()

    def _create_new_wallet(self) -> None:
        """Generates a new BIP-39 compatible Ethereum wallet."""
        if not self.enabled or not Account:
            return
        try:
            self._account = Account.create()
            wallet_data = {
                "address": self._account.address,
                "private_key": self._account.key.hex()
            }
            WALLET_FILE.write_text(json.dumps(wallet_data, indent=4))
            # Secure the file (Unix only)
            try:
                os.chmod(WALLET_FILE, 0o600)
            except Exception:
                pass
            logger.info(f"Generated new sovereign agent wallet: {self._account.address}")
        except Exception as e:
            logger.error(f"Failed to create wallet: {e}")

    @property
    def address(self) -> str:
        return self._account.address if self._account else ""

    def get_balance(self) -> float:
        """Returns the native balance (ETH) in the wallet."""
        if not self._account or not self.enabled or not self.w3:
            return 0.0
        try:
            balance_wei = self.w3.eth.get_balance(self._account.address)
            return float(self.w3.from_wei(balance_wei, 'ether'))
        except Exception as e:
            logger.error(f"Failed to fetch balance: {e}")
            return 0.0

    def get_status(self) -> WalletStatus:
        """Returns a summary of the wallet status."""
        connected = False
        if self.enabled and self.w3:
            try:
                connected = self.w3.is_connected()
            except Exception:
                pass
                
        return {
            "address": self.address,
            "balance": self.get_balance(),
            "network": "base", # Default
            "connected": connected,
            "has_private_key": self._account is not None,
            "controller_address": self._controller_address
        }

    def transfer(self, to_address: str, amount_eth: float) -> Optional[str]:
        """Performs a transfer of native ETH."""
        if not self.enabled or not self.w3 or not self._account:
            return None
            
        try:
            nonce = self.w3.eth.get_transaction_count(self._account.address)
            gas_price = self.w3.eth.gas_price
            
            tx = {
                'nonce': nonce,
                'to': to_address,
                'value': self.w3.to_wei(amount_eth, 'ether'),
                'gas': 21000,
                'gasPrice': gas_price,
                'chainId': self.w3.eth.chain_id
            }
            
            signed_tx = self.w3.eth.account.sign_transaction(tx, self._account.key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_tx.raw_transaction)
            logger.info(f"Transfer sent: {tx_hash.hex()}")
            return tx_hash.hex()
        except Exception as e:
            logger.error(f"Transfer failed: {e}")
            return None

# Singleton instance
wallet_service = WalletService()

