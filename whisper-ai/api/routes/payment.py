"""
Whisper AI - Payment Routes
Razorpay integration for subscriptions and token purchases
"""

import os
import hmac
import hashlib
import json
import time
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Request, Header
from pydantic import BaseModel
from loguru import logger
import httpx
from services.admin_state import get_payment_plans
from .profile import get_supabase
from utils.app_paths import DATA_ROOT, ensure_app_dirs

# Razorpay configuration
RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")
RAZORPAY_API_URL = "https://api.razorpay.com/v1"
PAYMENT_VALIDATION_PATH = DATA_ROOT / "runtime" / "payment_validation.json"

router = APIRouter(prefix="/payments", tags=["payments"])
ensure_app_dirs()


# Pydantic models
class CreateOrderRequest(BaseModel):
    plan_id: str  # 'pro_monthly' or 'tokens_100', 'tokens_500', 'tokens_1000'
    user_id: str


class VerifyPaymentRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
    user_id: str
    plan_id: str


class WebhookPayload(BaseModel):
    event: str
    payload: dict


# Plan definitions
PLANS = {
    "pro_monthly": {
        "name": "Pro Monthly",
        "amount": 9900,  # ₹99 in paise
        "currency": "INR",
        "tokens": 1000,
        "type": "subscription",
    },
    "tokens_100": {
        "name": "100 Tokens",
        "amount": 4900,  # ₹49
        "currency": "INR",
        "tokens": 100,
        "type": "addon",
    },
    "tokens_500": {
        "name": "500 Tokens",
        "amount": 14900,  # ₹149
        "currency": "INR",
        "tokens": 500,
        "type": "addon",
    },
    "tokens_1000": {
        "name": "1000 Tokens",
        "amount": 29900,  # ₹299
        "currency": "INR",
        "tokens": 1000,
        "type": "addon",
    },
}


def get_active_plans() -> dict:
    return get_payment_plans(PLANS)


def _payment_validation_state() -> dict:
    if not PAYMENT_VALIDATION_PATH.exists():
        return {}
    try:
        return json.loads(PAYMENT_VALIDATION_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_payment_validation_state(state: dict) -> dict:
    PAYMENT_VALIDATION_PATH.parent.mkdir(parents=True, exist_ok=True)
    PAYMENT_VALIDATION_PATH.write_text(json.dumps(state, ensure_ascii=True, indent=2), encoding="utf-8")
    return state


def payment_gateway_status() -> dict:
    state = _payment_validation_state()
    return {
        "configured": bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET),
        "provider": "razorpay",
        "key_id_prefix": f"{RAZORPAY_KEY_ID[:8]}..." if RAZORPAY_KEY_ID else "",
        "last_validated_at": state.get("last_validated_at"),
        "last_valid": state.get("last_valid"),
        "last_error": state.get("last_error"),
        "last_message": state.get("last_message"),
        "validated_endpoint": state.get("validated_endpoint"),
        "status_code": state.get("status_code"),
        "order_count_sample": state.get("order_count_sample"),
    }


async def validate_payment_gateway() -> dict:
    configured = bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)
    endpoint = "/orders?count=1"
    started_at = time.time()

    if not configured:
        state = _write_payment_validation_state(
            {
                "last_validated_at": time.time(),
                "last_valid": False,
                "last_error": "Payment gateway not configured",
                "last_message": "Payment gateway not configured",
                "validated_endpoint": endpoint,
                "status_code": None,
                "order_count_sample": None,
            }
        )
        return {
            **payment_gateway_status(),
            **state,
            "reachable": False,
            "duration_seconds": round(time.time() - started_at, 3),
        }

    if os.getenv("WHISPER_TEST_MODE", "false").lower() == "true":
        state = _write_payment_validation_state(
            {
                "last_validated_at": time.time(),
                "last_valid": True,
                "last_error": None,
                "last_message": "Synthetic Razorpay validation succeeded in test mode",
                "validated_endpoint": endpoint,
                "status_code": 200,
                "order_count_sample": 0,
            }
        )
        return {
            **payment_gateway_status(),
            **state,
            "reachable": True,
            "duration_seconds": round(time.time() - started_at, 3),
        }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{RAZORPAY_API_URL}/orders",
                params={"count": 1},
                auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET),
                timeout=20.0,
            )

        if response.status_code == 200:
            payload = response.json()
            items = payload.get("items") if isinstance(payload, dict) else None
            state = _write_payment_validation_state(
                {
                    "last_validated_at": time.time(),
                    "last_valid": True,
                    "last_error": None,
                    "last_message": "Razorpay credential validation succeeded",
                    "validated_endpoint": endpoint,
                    "status_code": response.status_code,
                    "order_count_sample": len(items) if isinstance(items, list) else None,
                }
            )
            return {
                **payment_gateway_status(),
                **state,
                "reachable": True,
                "duration_seconds": round(time.time() - started_at, 3),
            }

        message = f"Razorpay validation failed with status {response.status_code}"
        try:
            payload = response.json()
            if isinstance(payload, dict):
                error = payload.get("error") or {}
                message = error.get("description") or error.get("reason") or error.get("code") or message
        except Exception:
            pass

        state = _write_payment_validation_state(
            {
                "last_validated_at": time.time(),
                "last_valid": False,
                "last_error": message,
                "last_message": message,
                "validated_endpoint": endpoint,
                "status_code": response.status_code,
                "order_count_sample": None,
            }
        )
        return {
            **payment_gateway_status(),
            **state,
            "reachable": False,
            "duration_seconds": round(time.time() - started_at, 3),
        }
    except Exception as exc:
        message = str(exc)
        state = _write_payment_validation_state(
            {
                "last_validated_at": time.time(),
                "last_valid": False,
                "last_error": message,
                "last_message": message,
                "validated_endpoint": endpoint,
                "status_code": None,
                "order_count_sample": None,
            }
        )
        return {
            **payment_gateway_status(),
            **state,
            "reachable": False,
            "duration_seconds": round(time.time() - started_at, 3),
        }


async def create_razorpay_order(amount: int, currency: str, notes: dict) -> dict:
    """Create a Razorpay order."""
    if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
        raise HTTPException(status_code=500, detail="Payment gateway not configured")
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{RAZORPAY_API_URL}/orders",
                auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET),
                json={
                    "amount": amount,
                    "currency": currency,
                    "notes": notes,
                },
                timeout=30.0
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                logger.error(f"Razorpay order failed: {response.text}")
                raise HTTPException(status_code=500, detail="Failed to create order")
                
    except httpx.RequestError as e:
        logger.error(f"Razorpay request error: {e}")
        raise HTTPException(status_code=500, detail="Payment gateway error")


def verify_razorpay_signature(order_id: str, payment_id: str, signature: str) -> bool:
    """Verify Razorpay payment signature."""
    if not RAZORPAY_KEY_SECRET:
        return False
    
    message = f"{order_id}|{payment_id}"
    expected_signature = hmac.new(
        RAZORPAY_KEY_SECRET.encode(),
        message.encode(),
        hashlib.sha256
    ).hexdigest()
    
    return hmac.compare_digest(signature, expected_signature)


async def update_user_subscription(user_id: str, plan_id: str, payment_id: str) -> bool:
    """Update user's subscription in database."""
    plan = get_active_plans().get(plan_id)
    if not plan:
        return False

    try:
        db = get_supabase()
        profile_result = db.table("profiles").select("*").eq("id", user_id).execute()
        if not profile_result.data:
            return False

        profile = profile_result.data[0]
        if plan["type"] == "subscription":
            db.table("profiles").update(
                {
                    "subscription_tier": "pro",
                    "tokens_limit": 1000,
                    "tokens_used": 0,
                    "last_token_refresh": datetime.now().isoformat(),
                }
            ).eq("id", user_id).execute()
            db.table("subscriptions").insert(
                {
                    "user_id": user_id,
                    "tier": "pro",
                    "razorpay_payment_id": payment_id,
                    "amount": plan["amount"],
                    "status": "active",
                    "expires_at": (datetime.now() + timedelta(days=30)).isoformat(),
                }
            ).execute()
        else:
            current_limit = profile.get("tokens_limit", 20) or 20
            db.table("profiles").update({"tokens_limit": current_limit + plan["tokens"]}).eq("id", user_id).execute()
            db.table("token_purchases").insert(
                {
                    "user_id": user_id,
                    "tokens_purchased": plan["tokens"],
                    "amount": plan["amount"],
                    "razorpay_payment_id": payment_id,
                    "status": "completed",
                }
            ).execute()

        return True
    except Exception as e:
        logger.error(f"Error updating subscription: {e}")
        return False


@router.get("/plans")
async def get_plans():
    """Get available subscription plans and token packages."""
    plans = get_active_plans()
    return {
        "success": True,
        "plans": plans,
        "key_id": RAZORPAY_KEY_ID,  # Frontend needs this for checkout
    }


@router.post("/create-order")
async def create_order(request: CreateOrderRequest):
    """Create a Razorpay order for payment."""
    plan = get_active_plans().get(request.plan_id)
    if not plan:
        raise HTTPException(status_code=400, detail="Invalid plan")
    
    order = await create_razorpay_order(
        amount=plan["amount"],
        currency=plan["currency"],
        notes={
            "user_id": request.user_id,
            "plan_id": request.plan_id,
            "plan_name": plan["name"],
        }
    )
    
    return {
        "success": True,
        "order_id": order["id"],
        "amount": order["amount"],
        "currency": order["currency"],
        "key_id": RAZORPAY_KEY_ID,
        "plan": plan,
    }


@router.post("/verify")
async def verify_payment(request: VerifyPaymentRequest):
    """Verify payment signature and activate subscription/tokens."""
    # Verify signature
    if not verify_razorpay_signature(
        request.razorpay_order_id,
        request.razorpay_payment_id,
        request.razorpay_signature
    ):
        raise HTTPException(status_code=400, detail="Invalid payment signature")
    
    # Update user subscription
    success = await update_user_subscription(
        request.user_id,
        request.plan_id,
        request.razorpay_payment_id
    )
    
    if not success:
        raise HTTPException(status_code=500, detail="Failed to activate subscription")
    
    # Send notification
    try:
        from api.middleware.email_notifications import notify_admin_payment
        plan = get_active_plans().get(request.plan_id, {})
        await notify_admin_payment(
            event_type="Payment Received",
            user_email=request.user_id,  # In production, get actual email
            amount=plan.get("amount", 0),
            details={
                "order_id": request.razorpay_order_id,
                "payment_id": request.razorpay_payment_id,
                "plan": request.plan_id,
            }
        )
    except Exception as e:
        logger.warning(f"Failed to send payment notification: {e}")
    
    return {
        "success": True,
        "message": "Payment verified and subscription activated",
    }


@router.post("/webhook")
async def razorpay_webhook(request: Request):
    """Handle Razorpay webhooks."""
    try:
        payload = await request.json()
        event = payload.get("event", "")
        
        logger.info(f"Razorpay webhook: {event}")
        
        if event == "payment.captured":
            payment = payload.get("payload", {}).get("payment", {}).get("entity", {})
            notes = payment.get("notes", {})
            
            user_id = notes.get("user_id")
            plan_id = notes.get("plan_id")
            payment_id = payment.get("id")
            
            if user_id and plan_id:
                await update_user_subscription(user_id, plan_id, payment_id)
        
        elif event == "payment.failed":
            logger.warning(f"Payment failed: {payload}")
        
        return {"success": True}
        
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        return {"success": False, "error": str(e)}


@router.post("/subscribe")
async def subscribe_pro(request: CreateOrderRequest):
    """Quick endpoint for Pro subscription."""
    request.plan_id = "pro_monthly"
    return await create_order(request)


@router.post("/buy-tokens")
async def buy_tokens(request: CreateOrderRequest):
    """Quick endpoint for buying tokens."""
    if request.plan_id not in ["tokens_100", "tokens_500", "tokens_1000"]:
        raise HTTPException(status_code=400, detail="Invalid token package")
    return await create_order(request)
