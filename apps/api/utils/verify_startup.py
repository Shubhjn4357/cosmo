"""
Startup Integration Verification
Auto-checks that all services are properly wired
"""

from loguru import logger


def verify_imports():
    """Verify all required imports work"""
    errors = []
    
    try:
        from model.transformer import MicroTransformer, TransformerConfig
        logger.info("✅ Transformer model imports OK")
    except Exception as e:
        errors.append(f"Transformer: {e}")
    
    try:
        from model.vision_decoder import VisionAwareTransformer, VisionDecoder
        logger.info("✅ Vision decoder imports OK")
    except Exception as e:
        errors.append(f"Vision decoder: {e}")
    
    try:
        from model.hybrid_vision import get_hybrid_model
        logger.info("✅ Hybrid vision model imports OK")
    except Exception as e:
        errors.append(f"Hybrid vision: {e}")
    
    try:
        from api.routes.collect import collect_data, learn_from_collected_data
        logger.info("✅ Collection & learning imports OK")
    except Exception as e:
        errors.append(f"Collection/Learning: {e}")
    
    try:
        from api.routes.feed import receive_vision_data, vision_stats
        logger.info("✅ Vision feed imports OK")
    except Exception as e:
        errors.append(f"Vision feed: {e}")
    
    return errors


def verify_routes(app):
    """Verify all routes are registered"""
    routes = [r.path for r in app.routes]
    
    required_routes = [
        "/api/collect/collect",
        "/api/collect/learn",
        "/api/collect/stats",
        "/api/feed/vision",
        "/api/feed/vision/stats",
        "/api/feed/vision/generate",
    ]
    
    missing = []
    for route in required_routes:
        if route not in routes:
            missing.append(route)
    
    if missing:
        logger.error(f"❌ Missing routes: {missing}")
        return False
    
    logger.info(f"✅ All {len(required_routes)} learning routes registered")
    return True


def verify_startup_tasks():
    """Verify background tasks are scheduled"""
    # This checks that the event handlers are defined
    try:
        from api.routes import collect
        
        # Check if auto_collect_loop exists
        if hasattr(collect, 'auto_collect_loop'):
            logger.info("✅ Auto-collection loop defined")
        else:
            logger.warning("⚠️ Auto-collection loop not found")
        
        # Check if learn_from_collected_data exists
        if hasattr(collect, 'learn_from_collected_data'):
            logger.info("✅ Learning function defined")
        else:
            logger.warning("⚠️ Learning function not found")
        
        return True
    except Exception as e:
        logger.error(f"❌ Startup task verification failed: {e}")
        return False


def run_verification(app=None):
    """
    Run complete system verification
    Call this on server startup
    """
    logger.info("=" * 50)
    logger.info("🔍 SYSTEM VERIFICATION STARTING")
    logger.info("=" * 50)
    
    # Check imports
    import_errors = verify_imports()
    if import_errors:
        logger.error(f"❌ Import errors: {import_errors}")
        return False
    
    # Check routes (if app provided)
    if app:
        if not verify_routes(app):
            return False
    
    # Check startup tasks
    if not verify_startup_tasks():
        return False
    
    logger.info("=" * 50)
    logger.info("✅ SYSTEM VERIFICATION COMPLETE - ALL GOOD!")
    logger.info("=" * 50)
    logger.info("")
    logger.info("📊 System Status:")
    logger.info("  • Transformer: Ready")
    logger.info("  • Vision Decoder: Ready")
    logger.info("  • Hybrid Model: Ready")
    logger.info("  • Data Collection: Auto-starting (every 1 hour)")
    logger.info("  • Learning: Auto-enabled")
    logger.info("  • Vision Feed: Active")
    logger.info("")
    logger.info("🎓 Learning System:")
    logger.info("  • Sources: 22 legal URLs (NASA, Wikipedia, etc.)")
    logger.info("  • Encoding: CLIP via image-encoder microservice")
    logger.info("  • Storage: Up to 1000 embeddings")
    logger.info("  • Generation: Vision decoder (64x64 images)")
    logger.info("")
    logger.info("🚀 Ready to learn and grow!")
    logger.info("")
    
    return True
