import React, { useState, useEffect } from 'react';
import { Cpu,  RefreshCw } from 'lucide-react';
import { type ExecutionProfile } from '../../types';
import axios from 'axios';

const RuntimePanel = () => {
  const [profiles, setProfiles] = useState<ExecutionProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchProfiles();
  }, []);

  const fetchProfiles = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const res = await axios.get('/api/admin/runtime/profiles', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setProfiles(res.data.profiles || []);
      setSelectedProfile(res.data.active_profile || '');
    } catch (e: unknown) {
      console.error('Failed to fetch profiles:', e);
    }
  };

  const applyProfile = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      await axios.post(`/api/admin/runtime/profiles/${selectedProfile}/activate`, {}, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      fetchProfiles();
    } catch (e: unknown) {
      const errorMsg = axios.isAxiosError(e) ? e.response?.data?.detail : 'Unknown error';
      alert(`Failed to activate profile: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-fade-up">
      <div className="glass-panel p-8 rounded-premium space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan/20 flex items-center justify-center text-cyan">
            <Cpu size={20} />
          </div>
          <h3 className="text-xl font-bold">AI Runtime Config</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-text3 uppercase tracking-widest">Active Execution Profile</label>
              <select 
                value={selectedProfile}
                onChange={(e) => setSelectedProfile(e.target.value)}
                className="w-full glass-input"
              >
                {profiles.map(p => (
                  <option key={p.id} value={p.id} className="bg-surface text-text">{p.name}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-3">
              <button 
                onClick={applyProfile}
                className="flex-1 primary-btn"
                disabled={loading}
              >
                {loading ? 'Activating...' : 'Apply Profile'}
              </button>
              <button className="secondary-btn">
                <RefreshCw size={16} />
              </button>
            </div>
          </div>

          <div className="bg-bg p-6 rounded-xl border border-border space-y-4">
            <h5 className="text-xs font-bold text-text2 uppercase tracking-tight">Active Hardware Overlay</h5>
            <div className="space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="text-text3">Compute Threads</span>
                <span className="text-text font-mono">16</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-text3">Precision Mode</span>
                <span className="text-text font-mono">BitNet-4bit</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-text3">Process Tuning</span>
                <span className="text-green font-bold uppercase">Turbo</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {profiles.map(p => (
          <div 
            key={p.id} 
            className={`glass-panel p-6 rounded-premium border-l-4 transition-all ${selectedProfile === p.id ? 'border-l-primary' : 'border-l-border dark:opacity-60'}`}
          >
            <h6 className="font-bold text-text mb-1">{p.name}</h6>
            <p className="text-xs text-text3 leading-relaxed">{p.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RuntimePanel;
