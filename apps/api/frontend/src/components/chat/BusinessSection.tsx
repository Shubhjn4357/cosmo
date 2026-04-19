import React, { useState, useEffect } from 'react';
import { Briefcase, Play, Clock, Users } from 'lucide-react';
import { type BusinessRole, type BusinessSession } from '../../types';
import axios from 'axios';

const ROLE_COLORS: Record<string, string> = {
  ceo: '#8b5cf6', research: '#06b6d4', analyst: '#f59e0b',
  developer: '#10b981', writer: '#ec4899', reviewer: '#ef4444',
};

const BusinessSection = () => {
  const [goal, setGoal] = useState('');
  const [context, setContext] = useState('');
  const [sessions, setSessions] = useState<BusinessSession[]>([]);
  const [roles, setRoles] = useState<BusinessRole[]>([]);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [sessionsRes, rolesRes] = await Promise.all([
        axios.get('/api/cosmo/business/sessions'),
        axios.get('/api/cosmo/business/roles')
      ]);
      setSessions(sessionsRes.data.sessions || []);
      setRoles(rolesRes.data.roles || []);
    } catch (e: unknown) {
      console.error('Failed to fetch workforce data:', e);
    }
  };

  const fetchSessions = async () => {
    try {
      const res = await axios.get('/api/cosmo/business/sessions');
      setSessions(res.data.sessions || []);
    } catch (e: unknown) {
      console.error('Failed to update sessions:', e);
    }
  };

  const handleLaunch = async () => {
    if (!goal.trim() || launching) return;
    setLaunching(true);
    try {
      await axios.post('/api/cosmo/business/launch', {
        goal: goal.trim(),
        company_context: context.trim()
      });
      setGoal('');
      setContext('');
      fetchSessions();
    } catch (e:unknown) {
      console.error('Failed to launch workforce:', e);
      alert('Failed to launch workforce');
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-8 flex flex-col gap-8">
      <div className="max-w-4xl mx-auto w-full space-y-8">
        {/* Launch Card */}
        <section className="glass-panel rounded-premium p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center text-primary">
              <Briefcase size={20} />
            </div>
            <h3 className="text-xl font-bold">Deploy Autonomous AI Workforce</h3>
          </div>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-text3 uppercase">Mission Objective</label>
              <textarea 
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="e.g. Research our top 5 competitors and write a go-to-market strategy for our SaaS product"
                className="w-full h-24 glass-input resize-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-text3 uppercase">Company Context</label>
              <input 
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="e.g. B2C fitness app targeting Gen Z in Southeast Asia"
                className="w-full glass-input"
              />
            </div>

            <div className="flex flex-wrap gap-2 py-2">
              {roles.map(role => (
                <span 
                  key={role.id}
                  className="px-3 py-1 rounded-full text-[10px] font-bold border flex items-center gap-2"
                  style={{ 
                    borderColor: (ROLE_COLORS[role.id] || '#6b7280') + '44', 
                    color: ROLE_COLORS[role.id] || '#6b7280',
                    backgroundColor: (ROLE_COLORS[role.id] || '#6b7280') + '11'
                  }}
                >
                  <Users size={10} /> {role.name}
                </span>
              ))}
            </div>

            <button 
              onClick={handleLaunch}
              className="w-full primary-btn shadow-xl shadow-primary/20"
              disabled={launching}
            >
              {launching ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Deploying Specialist Agents...
                </>
              ) : (
                <>
                  <Play size={18} fill="currentColor" />
                  Launch Mission
                </>
              )}
            </button>
          </div>
        </section>

        {/* Sessions List */}
        <section className="space-y-4">
          <h4 className="text-[10px] font-bold text-text3 uppercase tracking-widest px-1">Active Intelligence Sessions</h4>
          <div className="grid grid-cols-1 gap-4">
            {sessions.map(session => (
              <div key={session.id} className="glass-panel rounded-premium p-5 flex items-center gap-6 hover:border-primary/50 transition-all cursor-pointer group">
                <div className="flex-1">
                  <h5 className="text-sm font-bold text-text group-hover:text-primary transition-colors">{session.goal}</h5>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-[10px] text-text3 font-medium flex items-center gap-1">
                      <Clock size={10} /> {session.task_count} Specialist Tasks
                    </span>
                    <span className="text-[10px] text-primary font-bold">{session.progress}% Computed</span>
                  </div>
                </div>
                
                <div className="flex flex-col items-end gap-2">
                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
                    session.status === 'completed' ? 'bg-green/10 text-green border border-green/20' :
                    session.status === 'failed' ? 'bg-error/10 text-error border border-error/20' :
                    'bg-primary/10 text-primary border border-primary/20'
                  }`}>
                    {session.status}
                  </span>
                  <div className="w-24 h-1 bg-surface2 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary transition-all duration-1000" 
                      style={{ width: `${session.progress}%` }} 
                    />
                  </div>
                </div>
              </div>
            ))}
            {sessions.length === 0 && (
              <div className="text-center py-12 text-text3 text-sm italic border border-dashed border-border rounded-premium">
                Ready to deploy your workforce...
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default BusinessSection;
