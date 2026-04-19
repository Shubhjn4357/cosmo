import React, { useState, useRef, useEffect } from 'react';
import { Send, Cpu, MessageCircle } from 'lucide-react';
import axios from 'axios';
import { type AgentStep, type ChatResponse } from '../../types';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  meta?: string;
  steps?: AgentStep[];
}

const ChatSection = () => {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: "👋 Cosmo is online. Ask anything — I'll plan, search, and reason to give you the best answer." }
  ]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'cosmo' | 'standard'>('cosmo');
  const [thinking, setThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, thinking]);

  const handleSend = async () => {
    if (!input.trim() || thinking) return;

    const userMsg: Message = { role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setThinking(true);

    try {
      const endpoint = mode === 'cosmo' ? '/api/cosmo/agent/chat' : '/api/chat';
      const response = await axios.post<ChatResponse>(endpoint, {
        message: userMsg.content,
        history: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        is_local: true,
      });

      const data = response.data;
      const assistantMsg: Message = {
        role: 'assistant',
        content: data.response || data.final_response || '',
        meta: `${data.model_used || 'cosmo'} · ${data.backend || 'multi-agent'}`,
        steps: data.agent_steps,
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (error: unknown) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error connecting to server.' }]);
    } finally {
      setThinking(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto p-8 space-y-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.map((msg, idx) => (
            <div 
              key={idx} 
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : msg.role === 'system' ? 'items-center' : 'items-start'} animate-fade-up`}
            >
              <div 
                className={`max-w-[85%] px-5 py-4 rounded-premium text-sm leading-relaxed shadow-sm border ${
                  msg.role === 'user' 
                    ? 'bg-primary/10 border-primary text-text' 
                    : msg.role === 'system'
                    ? 'bg-surface border-border text-text3 text-xs'
                    : 'bg-surface2 border-border text-text'
                }`}
              >
                {msg.content}
                
                {msg.steps && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {msg.steps.map((step, sidx) => (
                      <span key={sidx} className="bg-bg border border-border px-2 py-1 rounded text-[10px] font-bold text-primary">
                        {step.role.toUpperCase()}: {step.content.slice(0, 30)}...
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {msg.meta && <span className="mt-2 text-[10px] text-text3 font-medium uppercase tracking-tight px-1">{msg.meta}</span>}
            </div>
          ))}
          
          {thinking && (
            <div className="flex items-center gap-3 text-text3 text-sm italic">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" />
                <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:0.2s]" />
                <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:0.4s]" />
              </div>
              Cosmo is thinking...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="p-8 bg-surface border-t border-border shrink-0">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setMode('cosmo')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg border transition-all text-xs font-bold ${mode === 'cosmo' ? 'bg-primary/20 border-primary text-primary' : 'bg-surface2 border-border text-text3'}`}
            >
              <Cpu size={14} /> Cosmo Agent
            </button>
            <button 
              onClick={() => setMode('standard')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg border transition-all text-xs font-bold ${mode === 'standard' ? 'bg-primary/20 border-primary text-primary' : 'bg-surface2 border-border text-text3'}`}
            >
              <MessageCircle size={14} /> Standard Chat
            </button>
          </div>

          <div className="flex gap-3 items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Ask Cosmo anything..."
              className="flex-1 bg-surface2 border border-border rounded-xl text-text p-4 text-sm resize-none focus:border-primary outline-none transition-all placeholder:text-text3 min-h-[56px] max-h-40"
              rows={1}
            />
            <button 
              onClick={handleSend}
              className="w-14 h-14 bg-primary rounded-xl flex items-center justify-center text-white hover:opacity-90 transition-all shadow-lg shadow-primary/20 shrink-0"
              disabled={thinking}
            >
              <Send size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatSection;
