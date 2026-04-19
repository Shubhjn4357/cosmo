import React, { useState, useEffect } from 'react';
import { Activity, Server, Zap, Globe } from 'lucide-react';
import { type SystemAnalytics } from '../../types';
import axios from 'axios';

const OverviewPanel = () => {
  const [analytics, setAnalytics] = useState<SystemAnalytics | null>(null);

  
  const fetchAnalytics = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const res = await axios.get('/api/admin/system-analytics', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setAnalytics(res.data);
    } catch (e: unknown) {
      console.error('Failed to fetch analytics:', e);
    }
  };

    useEffect(() => {
      let isMounted = true;

      const initFetch = async () => {
        if (isMounted) {
          await fetchAnalytics();
        }
      };

      void initFetch();
      const interval = setInterval(() => {
        void fetchAnalytics();
      }, 15000);

      return () => {
        isMounted = false;
        clearInterval(interval);
      };
    }, []);
  const metrics = [
    { label: 'System Status', value: 'Prime', icon: Server, color: 'text-green' },
    { label: 'Active Memory', value: '4.2 GB', icon: Activity, color: 'text-primary' },
    { label: 'Inference Load', value: 'Low', icon: Zap, color: 'text-cyan' },
    { label: 'Uptime', value: '1d 4h', icon: Globe, color: 'text-text' },
  ];

  return (
    <div className="space-y-8 animate-fade-up">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {metrics.map((m, i) => (
          <div key={i} className="glass-panel p-5 rounded-premium flex flex-col gap-2 relative overflow-hidden group">
            <div className={`absolute -right-2 -top-2 opacity-[0.03] group-hover:opacity-[0.05] transition-opacity`}>
              <m.icon size={80} />
            </div>
            <div className="flex items-center gap-2">
              <m.icon size={16} className={m.color} />
              <span className="text-[10px] font-bold text-text3 uppercase tracking-widest">{m.label}</span>
            </div>
            <span className="text-2xl font-bold text-text">{m.value}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="glass-panel p-6 rounded-premium space-y-4">
          <h4 className="text-sm font-bold text-text">Operational Analytics</h4>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-surface2 rounded-xl border border-border">
              <p className="text-[10px] text-text3 font-bold uppercase">Total Generations</p>
              <p className="text-xl font-bold text-text">{analytics?.analytics.generations || 0}</p>
            </div>
            <div className="p-4 bg-surface2 rounded-xl border border-border">
              <p className="text-[10px] text-text3 font-bold uppercase">System Errors</p>
              <p className="text-xl font-bold text-error">{analytics?.analytics.errors || 0}</p>
            </div>
          </div>
        </div>

        <div className="glass-panel p-6 rounded-premium space-y-4">
          <h4 className="text-sm font-bold text-text">Active Jobs</h4>
          <div className="space-y-3">
            {['Training', 'Generation', 'Retrieval'].map((job, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 bg-bg border border-border rounded-lg">
                <span className="text-xs font-medium text-text2">{job}</span>
                <span className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
                  <span className="text-[10px] font-bold text-green uppercase">Stable</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OverviewPanel;
