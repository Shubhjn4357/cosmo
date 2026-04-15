"""
Production Configuration for 50-100 Concurrent Users
Optimized for HuggingFace Free Tier
"""

# === SERVER CONFIGURATION ===

# Request Queue Settings
MAX_CONCURRENT_REQUESTS = 10  # Max simultaneous HF API calls
REQUESTS_PER_MINUTE = 25      # Below HF limit (30/min) for safety margin
RESPONSE_CACHE_TTL = 300      # Cache responses for 5 minutes

# Timeout Settings
API_TIMEOUT = 60              # HF free tier can be slow
QUEUE_WAIT_TIMEOUT = 120      # Max time to wait in queue

# Connection Pool
MAX_CONNECTIONS = 20          # HTTP connection pool size
KEEPALIVE_TIMEOUT = 30        # Connection keepalive

# === CACHING STRATEGY ===

# Cache frequently requested prompts
ENABLE_RESPONSE_CACHE = True
CACHE_MAX_SIZE = 1000        # Maximum cached responses

# Common prompt patterns to cache aggressively
CACHE_PATTERNS = [
    "hello",
    "hi",
    "what",
    "how",
    "why",
    "explain",
]

# === FALLBACK MECHANISMS ===

# If HuggingFace fails, use these alternatives
FALLBACK_STRATEGY = "queue"  # Options: "queue", "local", "error"

# Local model as fallback (if available)
USE_LOCAL_FALLBACK = True
LOCAL_MODEL_PATH = "./models"

# === LOAD BALANCING ===

# Distribute across multiple HF accounts (if you have them)
HF_API_KEYS = [
    # Add multiple keys if you have backup accounts
    # "hf_key_1",
    # "hf_key_2",
]

# Round-robin across keys
ROTATE_API_KEYS = len(HF_API_KEYS) > 1

# === RATE LIMITING PER USER ===

# Prevent single user from monopolizing resources
MAX_REQUESTS_PER_USER_PER_MINUTE = 5
USER_RATE_LIMIT_ENABLED = True

# === MONITORING ===

# Log queue statistics
LOG_QUEUE_STATS_INTERVAL = 60  # Every 60 seconds
ENABLE_STATS_ENDPOINT = True    # /api/stats

# === OPTIMIZATION FLAGS ===

# Use streaming responses when possible
ENABLE_STREAMING = True

# Compress responses
ENABLE_COMPRESSION = True

# === ERROR HANDLING ===

# Retry failed requests
MAX_RETRIES = 2
RETRY_DELAY = 2  # seconds

# Graceful degradation
RETURN_PARTIAL_RESPONSES = True

# === MEMORY MANAGEMENT ===

# Clear cache when memory usage exceeds threshold
MAX_MEMORY_MB = 512
AUTO_CLEAR_CACHE = True

# === RECOMMENDED SETTINGS FOR PRODUCTION ===

"""
For 50-100 concurrent users on HuggingFace Free Tier:

1. MAX_CONCURRENT_REQUESTS = 10
   - Ensures we don't overwhelm HF
   - Allows some parallelization
   
2. REQUESTS_PER_MINUTE = 25
   - Below HF limit (30/min)
   - Safety margin for spikes
   
3. RESPONSE_CACHE_TTL = 300
   - 5 minute cache reduces API calls
   - Similar queries get cached response
   
4. Enable caching aggressively
   - Reduces redundant API calls
   - Improves response time
   
5. Implement user rate limiting
   - Prevents abuse
   - Fair resource distribution
   
6. Use fallback to local model
   - Graceful degradation
   - Better UX during high load
"""
