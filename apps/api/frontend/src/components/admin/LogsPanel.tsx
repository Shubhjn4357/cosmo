import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Trash2, Scroll } from 'lucide-react';

const LogsPanel = () => {
  const [logs, setLogs] = useState<string[]>(['Initializing system log stream...']);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    // Mocking real-time logs for demo. In production, connect to WebSocket.
    const interval = setInterval(() => {
      const demoLogs = [
        `[${new Date().toLocaleTimeString()}] INFO: API request processed in 45ms`,
        `[${new Date().toLocaleTimeString()}] DBG: Cache hit for smart_decision`,
        `[${new Date().toLocaleTimeString()}] WRN: Higher latency detected on provider: gemini`,
        `[${new Date().toLocaleTimeString()}] INFO: New business session launched: #biz-43A`,
      ];
      setLogs(prev => [...prev.slice(-100), demoLogs[Math.floor(Math.random() * demoLogs.length)]]);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  return (
    <div className="space-y-6 animate-fade-up flex flex-col h-[calc(100vh-250px)]">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-text2/10 flex items-center justify-center text-text2">
            <Terminal size={20} />
          </div>
          <div>
            <h3 className="text-xl font-bold">System Observability</h3>
            <p className="text-xs text-text3 font-medium uppercase tracking-tight">cosmo-server.log</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setAutoScroll(!autoScroll)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[10px] font-bold transition-all ${autoScroll ? 'bg-primary/10 border-primary text-primary' : 'bg-surface2 border-border text-text3'}`}
          >
            <Scroll size={12} /> {autoScroll ? 'AUTO-SCROLL ON' : 'AUTO-SCROLL OFF'}
          </button>
          <button 
            onClick={() => setLogs(['Terminal cleared.'])}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface2 border border-border text-[10px] font-bold text-text3 hover:text-error hover:border-error transition-all"
          >
            <Trash2 size={12} /> CLEAR
          </button>
        </div>
      </div>

      <div className="flex-1 glass-panel rounded-premium overflow-hidden flex flex-col shadow-2xl">
        <div className="px-4 py-2 bg-surface border-b border-border flex items-center gap-2 shrink-0">
          <div className="w-2.5 h-2.5 rounded-full bg-error/40" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/40" />
          <div className="w-2.5 h-2.5 rounded-full bg-green/40" />
          <span className="ml-2 text-[10px] font-bold text-text3 font-mono">ssh-tunnel@cosmo-server</span>
        </div>
        <pre 
          ref={scrollRef}
          className="flex-1 p-6 font-mono text-xs leading-relaxed overflow-y-auto bg-bg/80 text-text2 selection:bg-primary selection:text-white"
        >
          {logs.join('\n')}
        </pre>
      </div>
    </div>
  );
};

export default LogsPanel;
