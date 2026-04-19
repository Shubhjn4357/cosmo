import React, { useState } from 'react';
import ChatSection from '../components/chat/ChatSection';
import ImageSection from '../components/chat/ImageSection';
import BusinessSection from '../components/chat/BusinessSection';

type Section = 'chat' | 'image' | 'business';

const ChatPage = () => {
  const [activeSection, setActiveSection] = useState<Section>('chat');

  const getTitle = () => {
    switch(activeSection) {
      case 'chat': return { title: 'Cosmo Chat', sub: 'Multi-agent intelligence with Mythos memory' };
      case 'image': return { title: 'Image Create', sub: 'Generate high-quality images with local models' };
      case 'business': return { title: 'Business Agent', sub: 'Autonomous AI workforce — self-plans and executes' };
    }
  };

  const { title, sub } = getTitle();

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-8 py-5 border-b border-border bg-surface flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-bold text-text">{title}</h2>
          <p className="text-xs text-text3">{sub}</p>
        </div>
        
        <div className="flex bg-surface2 rounded-full p-1 border border-border">
          <button 
            onClick={() => setActiveSection('chat')}
            className={`px-6 py-1.5 rounded-full text-xs font-bold transition-all ${activeSection === 'chat' ? 'bg-primary text-white shadow-lg' : 'text-text2 hover:text-text'}`}
          >
            Chat
          </button>
          <button 
            onClick={() => setActiveSection('image')}
            className={`px-6 py-1.5 rounded-full text-xs font-bold transition-all ${activeSection === 'image' ? 'bg-primary text-white shadow-lg' : 'text-text2 hover:text-text'}`}
          >
            Image
          </button>
          <button 
            onClick={() => setActiveSection('business')}
            className={`px-6 py-1.5 rounded-full text-xs font-bold transition-all ${activeSection === 'business' ? 'bg-primary text-white shadow-lg' : 'text-text2 hover:text-text'}`}
          >
            Business
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden relative">
        {activeSection === 'chat' && <ChatSection />}
        {activeSection === 'image' && <ImageSection />}
        {activeSection === 'business' && <BusinessSection />}
      </div>
    </div>
  );
};

export default ChatPage;
