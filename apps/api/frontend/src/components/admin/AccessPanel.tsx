import React, { useState } from 'react';
import axios from 'axios';

const AccessPanel = ({ onSuccess }: { onSuccess: () => void }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await axios.post('/api/admin/login', { username, password });
      if (res.data.success && res.data.token) {
        localStorage.setItem('adminToken', res.data.token);
        onSuccess();
      } else {
        setError(res.data.message || 'Login failed');
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail || 'Connection refused. Master key mismatch.');
      } else {
        setError('An unexpected authorization error occurred.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-20 p-8 glass-panel rounded-premium space-y-6 shadow-2xl animate-fade-up">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-text">Admin Sovereignty</h2>
        <p className="text-sm text-text3 mt-2">Enter credentials to unlock global AI control surface.</p>
      </div>

      <form onSubmit={handleLogin} className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-bold text-text3 uppercase">Admin Alias</label>
          <input 
            className="w-full glass-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. cosmo_prime"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-text3 uppercase">Master SecretKey</label>
          <input 
            type="password"
            className="w-full glass-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        
        {error && <p className="text-xs text-error font-medium">{error}</p>}

        <button 
          type="submit"
          className="w-full primary-btn pulse-glow"
          disabled={loading}
        >
          {loading ? 'Authorizing...' : 'Unlock Workspace'}
        </button>
      </form>
    </div>
  );
};

export default AccessPanel;
