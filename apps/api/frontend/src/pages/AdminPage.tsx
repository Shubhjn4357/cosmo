import React, { useState } from 'react';
import { 
  Shield, Activity, Cpu, Database, Terminal, 
  Wallet, Briefcase, LogOut, RefreshCw
} from 'lucide-react';
import AccessPanel from '../components/admin/AccessPanel';
import OverviewPanel from '../components/admin/OverviewPanel';
import RuntimePanel from '../components/admin/RuntimePanel';
import DatasetPanel from '../components/admin/DatasetPanel';
import WalletPanel from '../components/admin/WalletPanel';
import LogsPanel from '../components/admin/LogsPanel';

type AdminSection = 'access' | 'overview' | 'runtime' | 'datasets' | 'wallet' | 'logs' | 'business';

const AdminPage = () => {
  const [activeSection, setActiveSection] = useState<AdminSection>('access');
  const [isAuthorized, setIsAuthorized] = useState(() => {
    return !!localStorage.getItem('adminToken');
  });

  if (!isAuthorized && activeSection !== 'access') {
    setActiveSection('access');
  }

  const navItems = [
    { id: 'access', label: 'Security', icon: Shield },
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'runtime', label: 'AI Runtime', icon: Cpu },
    { id: 'datasets', label: 'Data Hub', icon: Database },
    { id: 'wallet', label: 'Sovereign Wallet', icon: Wallet },
    { id: 'logs', label: 'System Logs', icon: Terminal },
    { id: 'business', label: 'Business Ops', icon: Briefcase },
  ];

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Admin Sidebar */}
      <aside className="w-56 bg-surface2 border-r border-border h-full flex flex-col p-4 shrink-0">
        <div className="mb-8 px-2">
          <h3 className="text-xs font-bold text-text3 uppercase tracking-widest">Command Center</h3>
        </div>
        
        <nav className="space-y-1">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id as AdminSection)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeSection === item.id 
                  ? 'bg-primary text-white shadow-lg shadow-primary/20' 
                  : 'text-text2 hover:bg-surface hover:text-text'
              }`}
            >
              <item.icon size={16} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto space-y-2">
          <button className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-text3 hover:bg-error/10 hover:text-error transition-all">
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </aside>

      {/* Admin Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-bg/50">
        <header className="px-8 py-5 border-b border-border bg-surface/50 backdrop-blur-sm flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-bold text-text">Workspace Control</h2>
            <p className="text-xs text-text3">Operational grouping for secure AI infrastructure.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${isAuthorized ? 'bg-green/10 text-green border border-green/20' : 'bg-error/10 text-error border border-error/20'}`}>
              {isAuthorized ? 'Authorized' : 'Locked'}
            </div>
            <button className="p-2 bg-surface2 border border-border rounded-lg text-text3 hover:text-primary transition-all">
              <RefreshCw size={16} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 relative">
          {!isAuthorized && <AccessPanel onSuccess={() => setIsAuthorized(true)} />}
          
          {isAuthorized && (
            <div className="animate-fade-up space-y-8">
              {activeSection === 'overview' && <OverviewPanel />}
              {activeSection === 'runtime' && <RuntimePanel />}
              {activeSection === 'datasets' && <DatasetPanel />}
              {activeSection === 'wallet' && <WalletPanel />}
              {activeSection === 'logs' && <LogsPanel />}
              {activeSection === 'access' && <AccessPanel onSuccess={() => setIsAuthorized(true)} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminPage;
