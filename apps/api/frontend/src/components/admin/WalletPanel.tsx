import React, { useState, useEffect } from 'react';
import { Shield, Link } from 'lucide-react';
import axios from 'axios';

import { type AgentStatus } from '../../types';

const WalletPanel = () => {
  const [account, setAccount] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchAgentStatus();
  }, []);

  const fetchAgentStatus = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const res = await axios.get('/api/admin/agent/status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setAgentStatus(res.data);
    } catch (e: unknown) {
      console.error('Failed to fetch agent status:', e);
    }
  };

  const connectMetamask = async () => {
    if (window.ethereum) {
      try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[];
        setAccount(accounts[0]);
      } catch (err: unknown) {
        console.error('Failed to connect to Metamask:', err);
        alert('User denied account access');
      }
    } else {
      alert('Metamask not detected');
    }
  };

  const linkController = async () => {
    if (!account) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      await axios.post('/api/admin/agent/link-controller', 
        { address: account },
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      fetchAgentStatus();
      alert('Controller linked successfully');
    } catch (e: unknown) {
      console.error('Failed to link controller:', e);
      alert('Failed to link controller');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <div className="glass-panel rounded-premium p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center text-primary">
            <Shield size={20} />
          </div>
          <h3 className="text-xl font-bold">Agent Sovereignty</h3>
        </div>

        <div className="space-y-4">
          <div className="bg-bg p-4 rounded-xl border border-border">
            <p className="text-[10px] text-text3 font-bold uppercase mb-2">Internal Wallet Address</p>
            <code className="text-xs text-text">{agentStatus?.wallet.address || '0x...'}</code>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-text2">Native Balance</span>
            <span className="text-2xl font-bold text-primary">
              {agentStatus?.wallet.balance?.toFixed(4) || '0.000'} ETH
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded-full font-bold">BASE MAINNET</span>
            <span className="text-[10px] px-2 py-0.5 bg-green/10 text-green border border-green/20 rounded-full font-bold">SOVEREIGN</span>
          </div>
        </div>
      </div>

      <div className="glass-panel rounded-premium p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan/20 flex items-center justify-center text-cyan">
            <Link size={20} />
          </div>
          <h3 className="text-xl font-bold">Controller Overlay</h3>
        </div>

        <div className="space-y-6">
          {!account ? (
            <button 
              onClick={connectMetamask}
              className="w-full primary-btn bg-gradient-to-r from-[#f6851b] to-[#e2761b] shadow-xl shadow-orange-500/10"
            >
              Connect Metamask
            </button>
          ) : (
            <div className="space-y-4">
              <div className="bg-bg p-4 rounded-xl border border-orange-500/20">
                <p className="text-[10px] text-orange-500 font-bold uppercase mb-2 text-center">Metamask Connected</p>
                <p className="text-xs text-text text-center font-mono truncate">{account}</p>
              </div>

              <button 
                onClick={linkController}
                className="w-full secondary-btn border-primary/50 text-primary"
                disabled={loading}
              >
                {loading ? 'Linking...' : 'Link as Controller'}
              </button>
            </div>
          )}

          <div className="p-4 bg-surface2 rounded-xl border border-border">
            <p className="text-[10px] text-text3 font-bold uppercase mb-1">Authenticated Controller</p>
            <p className="text-xs font-mono text-text2 truncate">
              {agentStatus?.wallet.controller_address || 'Not Linked'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WalletPanel;
