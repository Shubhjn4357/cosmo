import { NavLink } from 'react-router-dom';
import { MessageSquare, Activity } from 'lucide-react';

const Sidebar = () => {
  return (
    <aside className="w-64 bg-surface border-r border-border h-full flex flex-col p-5">
      <div className="flex items-center gap-3 mb-10">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-cyan flex items-center justify-center text-xl">
          🌌
        </div>
        <div>
          <h1 className="text-lg font-bold">Cosmo AI</h1>
          <p className="text-[10px] text-text3 font-bold tracking-widest uppercase">Autonomous Hub</p>
        </div>
      </div>

      <nav className="flex-1 flex flex-col gap-2">
        <label className="text-[10px] font-bold text-text3 uppercase tracking-wider px-3 mb-1">Intelligence</label>
        <NavLink 
          to="/chat" 
          className={({ isActive }) => 
            `flex items-center gap-3 px-4 py-3 rounded-premium transition-all ${isActive ? 'bg-primary/20 text-primary' : 'text-text2 hover:bg-surface2 hover:text-text'}`
          }
        >
          <MessageSquare size={18} />
          <span className="text-sm font-medium">Unified Chat</span>
        </NavLink>

        <label className="text-[10px] font-bold text-text3 uppercase tracking-wider px-3 mt-6 mb-1">Operations</label>
        <NavLink 
          to="/admin-ui" 
          className={({ isActive }) => 
            `flex items-center gap-3 px-4 py-3 rounded-premium transition-all ${isActive ? 'bg-primary/20 text-primary' : 'text-text2 hover:bg-surface2 hover:text-text'}`
          }
        >
          <Activity size={18} />
          <span className="text-sm font-medium">Command Center</span>
        </NavLink>
      </nav>

      <div className="mt-auto pt-5 border-t border-border flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-green animate-pulse" />
        <span className="text-xs text-text3 font-medium">System Stable</span>
      </div>
    </aside>
  );
};

export default Sidebar;
