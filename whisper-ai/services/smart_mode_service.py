"""
Whisper AI - Enhanced Smart Mode Service
Multi-provider AI racing with quality scoring and intelligent selection
Races: Gemini, HuggingFace, AI Horde, Local LLMs
"""

import asyncio
import os
import re
import time
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass
from collections import deque
import httpx
from loguru import logger
from services.admin_state import get_model_enabled


@dataclass
class ProviderResponse:
    """Response from a provider"""
    success: bool
    response: str
    provider: str
    model: str
    response_time: float
    error: Optional[str] = None


class ProviderHealthMonitor:
    """Track provider health and performance"""
    
    def __init__(self):
        self.response_times: Dict[str, deque] = {
            'gemini': deque(maxlen=10),
            'huggingface': deque(maxlen=10),
            'horde': deque(maxlen=10),
            'local': deque(maxlen=10),
        }
        self.failure_counts: Dict[str, int] = {
            'gemini': 0,
            'huggingface': 0,
            'horde': 0,
            'local': 0,
        }
    
    def record_success(self, provider: str, response_time: float):
        """Record successful response"""
        if provider in self.response_times:
            self.response_times[provider].append(response_time)
            self.failure_counts[provider] = max(0, self.failure_counts[provider] - 1)
    
    def record_failure(self, provider: str):
        """Record failed response"""
        if provider in self.failure_counts:
            self.failure_counts[provider] += 1
    
    def get_avg_response_time(self, provider: str) -> float:
        """Get average response time for provider"""
        if provider in self.response_times and self.response_times[provider]:
            return sum(self.response_times[provider]) / len(self.response_times[provider])
        return 999.0  # Unknown = slow
    
    def is_provider_healthy(self, provider: str) -> bool:
        """Check if provider is healthy (< 3 consecutive failures)"""
        return self.failure_counts.get(provider, 0) < 3


class SmartModeService:
    """
    Enhanced Smart Mode: Races multiple AI providers and returns best response
    - Parallel execution with cancellation
    - Quality + speed scoring
    - Provider health monitoring
    """
    
    def __init__(
        self,
        gemini_key: Optional[str] = None,
        hf_key: Optional[str] = None,
        horde_key: Optional[str] = None,
        user_hf_key: Optional[str] = None
    ):
        self.gemini_key = gemini_key
        self.hf_key = hf_key
        self.user_hf_key = user_hf_key  # User's custom HF key
        self.horde_key = horde_key or '0000000000'
        self.timeout = float(os.getenv("SMART_MODE_TIMEOUT_SECONDS", "20"))
        self.gemini_model = os.getenv("SMART_MODE_GEMINI_MODEL", "gemini-2.5-flash")
        self.health_monitor = ProviderHealthMonitor()

    def _normalize_turn(self, turn: Dict[str, Any]) -> Optional[Tuple[str, str]]:
        content = (turn.get("content") or turn.get("text") or "").strip()
        if not content:
            return None

        role = turn.get("role")
        if role not in {"user", "assistant"}:
            role = "assistant" if turn.get("isUser") is False else "user"

        return role, content

    def _is_horde_enabled(self) -> bool:
        return bool(self.horde_key and self.horde_key != '0000000000')

    def _provider_enabled(self, provider: str) -> bool:
        return get_model_enabled(f"smart.{provider}", True)

    def _build_local_prompt(self, prompt: str, context: Optional[List[Dict]]) -> str:
        from api.routes.chat import DEFAULT_SYSTEM_PROMPT

        prompt_parts = [
            "<|im_start|>system",
            DEFAULT_SYSTEM_PROMPT,
            "<|im_end|>",
        ]

        for turn in (context or [])[-8:]:
            normalized = self._normalize_turn(turn)
            if normalized is None:
                continue
            role, content = normalized
            prompt_parts.extend(
                [
                    f"<|im_start|>{role}",
                    content,
                    "<|im_end|>",
                ]
            )

        prompt_parts.extend(
            [
                "<|im_start|>user",
                prompt,
                "<|im_end|>",
                "<|im_start|>assistant",
            ]
        )
        return "\n\n".join(prompt_parts)
    
    def _score_response(
        self,
        response: str,
        response_time: float,
        provider: str
    ) -> float:
        """
        Score response based on quality + speed
        
        Returns: float between 0-1 (higher = better)
        """
        # Quality scoring
        length = len(response)
        
        # Length score (prefer 100-1000 char responses)
        if length < 20:
            length_score = 0.0  # Too short
        elif 100 <= length <= 1000:
            length_score = 1.0  # Perfect
        elif length < 100:
            length_score = length / 100  # Partial credit
        else:
            length_score = max(0.5, 1 - (length - 1000) / 2000)  # Penalize very long
        
        # Coherence score (check for complete sentences)
        has_punctuation = bool(re.search(r'[.!?]', response))
        has_capital = bool(re.search(r'[A-Z]', response))
        no_errors = 'error' not in response.lower() and 'sorry' not in response.lower()[:50]
        
        coherence_score = (
            (0.4 if has_punctuation else 0.0) +
            (0.3 if has_capital else 0.0) +
            (0.3 if no_errors else 0.0)
        )
        
        # Speed score (faster = better, 10s = 0 score)
        speed_score = max(0, 1 - (response_time / self.timeout))
        
        # Provider weights (premium providers get bonus)
        provider_weights = {
            'gemini': 1.2,      # Best quality
            'huggingface': 1.1, # Good quality
            'horde': 0.9,       # Community-powered
            'local': 0.8        # Local model
        }
        weight = provider_weights.get(provider, 1.0)
        
        # Combined score
        total_score = (
            length_score * 0.3 +
            coherence_score * 0.4 +
            speed_score * 0.3
        ) * weight
        
        logger.debug(
            f"{provider} score: {total_score:.2f} "
            f"(len={length_score:.2f}, coh={coherence_score:.2f}, "
            f"speed={speed_score:.2f}, time={response_time:.2f}s)"
        )
        
        return total_score
    
    async def generate_smart(
        self,
        prompt: str,
        context: Optional[List[Dict]] = None,
        max_tokens: int = 500
    ) -> Dict[str, Any]:
        """
        Generate using Smart Mode - races all providers
        
        Returns best quality response within timeout
        """
        logger.info(f"Smart Mode: racing providers for prompt ({len(prompt)} chars)")
        
        # Create tasks for all healthy providers
        tasks = []
        task_names = []
        
        if self.gemini_key and self._provider_enabled('gemini') and self.health_monitor.is_provider_healthy('gemini'):
            tasks.append(asyncio.create_task(self._try_gemini(prompt, context, max_tokens)))
            task_names.append('gemini')
        
        if (self.user_hf_key or self.hf_key) and self._provider_enabled('huggingface') and self.health_monitor.is_provider_healthy('huggingface'):
            tasks.append(asyncio.create_task(self._try_huggingface(prompt, context, max_tokens)))
            task_names.append('huggingface')
        
        if self._is_horde_enabled() and self._provider_enabled('horde') and self.health_monitor.is_provider_healthy('horde'):
            tasks.append(asyncio.create_task(self._try_horde(prompt, context, max_tokens)))
            task_names.append('horde')
        
        # Always try local if available
        if self._provider_enabled('local') and self.health_monitor.is_provider_healthy('local'):
            tasks.append(asyncio.create_task(self._try_local(prompt, context, max_tokens)))
            task_names.append('local')
        
        if not tasks:
            return {
                'success': False,
                'error': 'No providers available',
                'model_used': 'none'
            }
        
        logger.info(f"Racing {len(tasks)} providers: {', '.join(task_names)}")
        
        # Race all providers with timeout
        responses: List[ProviderResponse] = []
        quality_threshold = 0.7  # Minimum quality score to accept immediately
        
        try:
            # Wait for responses with timeout
            for task in asyncio.as_completed(tasks, timeout=self.timeout):
                try:
                    response = await task
                    
                    if response and response.success:
                        responses.append(response)
                        
                        # Score this response
                        score = self._score_response(
                            response.response,
                            response.response_time,
                            response.provider
                        )
                        
                        # If high quality response, cancel remaining and return
                        if score >= quality_threshold:
                            logger.info(
                                f"{response.provider} won with score {score:.2f} "
                                f"in {response.response_time:.2f}s - cancelling others"
                            )
                            
                            # Cancel remaining tasks
                            for t in tasks:
                                if not t.done():
                                    t.cancel()
                            
                            # Record success
                            self.health_monitor.record_success(
                                response.provider,
                                response.response_time
                            )
                            
                            return {
                                'success': True,
                                'response': response.response,
                                'model_used': response.model,
                                'provider': response.provider,
                                'response_time': response.response_time,
                                'score': score,
                                'providers_tried': task_names
                            }
                    else:
                        # Record failure
                        if response:
                            self.health_monitor.record_failure(response.provider)
                        
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    logger.warning(f"Provider task error: {e}")
        
        except asyncio.TimeoutError:
            logger.warning(f"Timeout after {self.timeout}s - using best available response")
            # Cancel all remaining tasks
            for t in tasks:
                if not t.done():
                    t.cancel()
        
        # If we have any responses, pick the best one
        if responses:
            # Score all responses
            scored_responses = [
                (
                    r,
                    self._score_response(r.response, r.response_time, r.provider)
                )
                for r in responses
            ]
            
            # Pick highest scoring
            best_response, best_score = max(scored_responses, key=lambda x: x[1])
            
            logger.info(
                f"Best response: {best_response.provider} "
                f"(score: {best_score:.2f}, time: {best_response.response_time:.2f}s)"
            )
            
            # Record success
            self.health_monitor.record_success(
                best_response.provider,
                best_response.response_time
            )
            
            return {
                'success': True,
                'response': best_response.response,
                'model_used': best_response.model,
                'provider': best_response.provider,
                'response_time': best_response.response_time,
                'score': best_score,
                'providers_tried': task_names,
                'total_responses': len(responses)
            }
        
        # Last-chance local fallback for slow CPU runtimes.
        if self._provider_enabled('local') and self.health_monitor.is_provider_healthy('local'):
            logger.warning("Smart Mode race produced no usable response; trying local fallback")
            fallback = await self._try_local(prompt, context, max_tokens)
            if fallback.success:
                self.health_monitor.record_success(fallback.provider, fallback.response_time)
                return {
                    'success': True,
                    'response': fallback.response,
                    'model_used': fallback.model,
                    'provider': fallback.provider,
                    'response_time': fallback.response_time,
                    'score': self._score_response(fallback.response, fallback.response_time, fallback.provider),
                    'providers_tried': task_names + ['local-fallback'],
                }

        # All providers failed
        logger.error("All providers failed")
        return {
            'success': False,
            'error': 'All AI providers failed to respond',
            'model_used': 'none',
            'providers_tried': task_names
        }
    
    async def _try_gemini(
        self,
        prompt: str,
        context: Optional[List[Dict]],
        max_tokens: int
    ) -> ProviderResponse:
        """Try Google Gemini API"""
        start_time = time.time()
        provider = 'gemini'
        model = self.gemini_model
        
        try:
            from api.routes.chat import DEFAULT_SYSTEM_PROMPT

            contents = []
            for turn in (context or [])[-8:]:
                normalized = self._normalize_turn(turn)
                if normalized is None:
                    continue
                role, content = normalized
                contents.append(
                    {
                        'role': 'model' if role == 'assistant' else 'user',
                        'parts': [{'text': content}],
                    }
                )
            contents.append({'role': 'user', 'parts': [{'text': prompt}]})

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={self.gemini_key}',
                    json={
                        'systemInstruction': {
                            'parts': [{'text': DEFAULT_SYSTEM_PROMPT}],
                        },
                        'contents': contents,
                        'generationConfig': {
                            'maxOutputTokens': max_tokens,
                            'temperature': 0.8
                        }
                    }
                )
                
                elapsed = time.time() - start_time
                
                if response.status_code == 200:
                    data = response.json()
                    candidates = data.get('candidates') or []
                    parts = candidates[0].get('content', {}).get('parts', []) if candidates else []
                    text = ''.join(part.get('text', '') for part in parts).strip()
                    
                    return ProviderResponse(
                        success=bool(text),
                        response=text,
                        provider=provider,
                        model=model,
                        response_time=elapsed
                    )
                else:
                    return ProviderResponse(
                        success=False,
                        response='',
                        provider=provider,
                        model=model,
                        response_time=elapsed,
                        error=f"HTTP {response.status_code}"
                    )
        
        except Exception as e:
            return ProviderResponse(
                success=False,
                response='',
                provider=provider,
                model=model,
                response_time=time.time() - start_time,
                error=str(e)
            )
    
    async def _try_huggingface(
        self,
        prompt: str,
        context: Optional[List[Dict]],
        max_tokens: int
    ) -> ProviderResponse:
        """Try HuggingFace Inference API"""
        start_time = time.time()
        provider = 'huggingface'
        
        # Use user's key if available, otherwise server key
        api_key = self.user_hf_key or self.hf_key
        
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2',
                    headers={'Authorization': f'Bearer {api_key}'},
                    json={
                        'inputs': f"<s>[INST] {prompt} [/INST]",
                        'parameters': {
                            'max_new_tokens': max_tokens,
                            'temperature': 0.8,
                            'do_sample': True
                        }
                    }
                )
                
                elapsed = time.time() - start_time
                
                if response.status_code == 200:
                    data = response.json()
                    
                    # Extract response text
                    if isinstance(data, list) and len(data) > 0:
                        text = data[0].get('generated_text', '')
                        # Remove prompt echo
                        if '[/INST]' in text:
                            text = text.split('[/INST]')[-1].strip()
                    else:
                        text = ''
                    
                    return ProviderResponse(
                        success=bool(text),
                        response=text,
                        provider=provider,
                        model='Mistral 7B Instruct',
                        response_time=elapsed
                    )
                else:
                    return ProviderResponse(
                        success=False,
                        response='',
                        provider=provider,
                        model='Mistral 7B Instruct',
                        response_time=elapsed,
                        error=f"HTTP {response.status_code}"
                    )
        
        except Exception as e:
            return ProviderResponse(
                success=False,
                response='',
                provider=provider,
                model='Mistral 7B Instruct',
                response_time=time.time() - start_time,
                error=str(e)
            )
    
    async def _try_horde(
        self,
        prompt: str,
        context: Optional[List[Dict]],
        max_tokens: int
    ) -> ProviderResponse:
        """Try AI Horde (community-powered)"""
        start_time = time.time()
        provider = 'horde'
        
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                # Submit request
                response = await client.post(
                    'https://stablehorde.net/api/v2/generate/text/async',
                    json={
                        'prompt': prompt,
                        'params': {
                            'max_length': max_tokens,
                            'max_context_length': 2048,
                            'temperature': 0.8
                        },
                        'models': ['koboldcpp/LLaMA2-13B-Tiefighter']
                    },
                    headers={'apikey': self.horde_key}
                )
                
                if response.status_code == 202:
                    task_data = response.json()
                    task_id = task_data.get('id')
                    
                    # Poll for result (max self.timeout seconds)
                    max_polls = int(self.timeout)
                    for _ in range(max_polls):
                        await asyncio.sleep(1)
                        
                        check_response = await client.get(
                            f'https://stablehorde.net/api/v2/generate/text/status/{task_id}'
                        )
                        
                        if check_response.status_code == 200:
                            result = check_response.json()
                            if result.get('done'):
                                elapsed = time.time() - start_time
                                generations = result.get('generations', [])
                                
                                if generations:
                                    text = generations[0].get('text', '')
                                    return ProviderResponse(
                                        success=bool(text),
                                        response=text,
                                        provider=provider,
                                        model='AI Horde (LLaMA2-13B)',
                                        response_time=elapsed
                                    )
                    
                    # Timeout waiting for horde
                    return ProviderResponse(
                        success=False,
                        response='',
                        provider=provider,
                        model='AI Horde',
                        response_time=time.time() - start_time,
                        error='Timeout waiting for generation'
                    )
                else:
                    return ProviderResponse(
                        success=False,
                        response='',
                        provider=provider,
                        model='AI Horde',
                        response_time=time.time() - start_time,
                        error=f"HTTP {response.status_code}"
                    )
        
        except Exception as e:
            return ProviderResponse(
                success=False,
                response='',
                provider=provider,
                model='AI Horde',
                response_time=time.time() - start_time,
                error=str(e)
            )
    
    async def _try_local(
        self,
        prompt: str,
        context: Optional[List[Dict]],
        max_tokens: int
    ) -> ProviderResponse:
        """Try local Whisper AI model"""
        start_time = time.time()
        provider = 'local'
        
        try:
            from api.route import get_app_state

            state = get_app_state()
            if state.chat_runtime is None:
                raise RuntimeError("Chat runtime not configured")

            from services.complex_task_router import generate_server_response

            result = await asyncio.to_thread(
                generate_server_response,
                prompt=self._build_local_prompt(prompt, context),
                history=context or [],
                fallback_runtime=state.chat_runtime,
                max_new_tokens=max_tokens,
                temperature=0.7,
                top_p=0.9,
            )
            text = (result.get("text") or "").strip()

            return ProviderResponse(
                success=bool(text),
                response=text,
                provider=provider,
                model=result.get("model_used", "Whisper AI (Local)"),
                response_time=time.time() - start_time,
            )

        except Exception as e:
            return ProviderResponse(
                success=False,
                response='',
                provider=provider,
                model='Whisper AI (Local)',
                response_time=time.time() - start_time,
                error=str(e)
            )
    
    async def get_model_status(self) -> Dict[str, bool]:
        """Check which providers are currently available"""
        statuses = {}
        
        # Gemini
        statuses['gemini'] = bool(self.gemini_key) and self._provider_enabled('gemini') and self.health_monitor.is_provider_healthy('gemini')
        
        # HuggingFace
        statuses['huggingface'] = bool(self.user_hf_key or self.hf_key) and self._provider_enabled('huggingface') and self.health_monitor.is_provider_healthy('huggingface')
        
        # AI Horde (always available)
        statuses['horde'] = self._is_horde_enabled() and self._provider_enabled('horde') and self.health_monitor.is_provider_healthy('horde')
        
        # Local model
        try:
            from api.route import get_app_state

            state = get_app_state()
            statuses['local'] = state.chat_runtime is not None and self._provider_enabled('local') and self.health_monitor.is_provider_healthy('local')
        except Exception:
            statuses['local'] = False
        
        return statuses
