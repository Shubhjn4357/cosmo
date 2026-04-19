import React, { useState, useEffect } from 'react';
import { ImageIcon, Command, ArrowRight } from 'lucide-react';
import axios from 'axios';

interface ImageModel {
  id: string;
  name: string;
  speed?: string;
  description?: string;
  downloaded?: boolean;
}

const ImageSection = () => {
  const [prompt, setPrompt] = useState('');
  const [models, setModels] = useState<ImageModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ url: string; seed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const loadModels = async () => {
      if (isMounted) {
        await fetchModels();
      }
    };
    void loadModels();
    return () => { isMounted = false; };
  }, []);

  const fetchModels = async () => {
    try {
      const res = await axios.get('/api/image/models');
      setModels(res.data.models || []);
      setSelectedModel(res.data.current_model || 'cyberrealistic-v9');
    } catch (e: unknown) {
      console.error('Failed to fetch models:', e);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || generating) return;

    setGenerating(true);
    setResult(null);
    setError(null);

    try {
      const res = await axios.post('/api/image/generate', {
        prompt: prompt.trim(),
        model_id: selectedModel,
        width: 512,
        height: 512,
        is_local: true,
      });
      setResult({ url: res.data.image_url, seed: res.data.seed });
    } catch (e: unknown) {
      if (axios.isAxiosError(e)) {
        setError(e.response?.data?.detail || e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Unknown generation error');
      }
    } finally {
      setGenerating(false);
    }
  };

  const currentModelDetails = models.find(m => m.id === selectedModel);

  return (
    <div className="h-full overflow-y-auto p-8 bg-bg">
      <div className="max-w-3xl mx-auto space-y-8 animate-fade-up">
        <section className="glass-panel rounded-premium p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center text-primary">
              <ImageIcon size={20} />
            </div>
            <h3 className="text-xl font-bold">AIA Image Generation</h3>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-text3 uppercase">Inference Model</label>
              <select 
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full glass-input"
              >
                {models.map(m => (
                  <option key={m.id} value={m.id} className="bg-surface text-text">
                    {m.name} ({m.speed || 'local'})
                  </option>
                ))}
              </select>
              {currentModelDetails && (
                <p className="text-[10px] text-text3 font-medium">
                  {currentModelDetails.description}. {currentModelDetails.downloaded ? '✅ Hardware Ready' : '⏳ Model Pending'}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-text3 uppercase">Prompt Visualization</label>
              <textarea 
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="A cinematic shot of a futuristic city at night, neon-lit, 8k..."
                className="w-full h-32 glass-input resize-none"
              />
            </div>

            <button 
              onClick={handleGenerate}
              className="w-full primary-btn mt-4 shadow-xl shadow-primary/20"
              disabled={generating}
            >
              {generating ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Generating Masterpiece...
                </>
              ) : (
                <>
                  <Command size={18} />
                  Initiate Generation
                  <ArrowRight size={16} />
                </>
              )}
            </button>
            {error && <p className="text-xs text-error font-medium">{error}</p>}
          </div>
        </section>

        {result && (
          <section className="glass-panel rounded-premium p-4 animate-fade-up">
            <img src={result.url} alt="Generated" className="w-full h-auto rounded-lg shadow-2xl" />
            <div className="mt-4 flex items-center justify-between px-2">
              <span className="text-xs text-text3 font-bold uppercase">Seed: {result.seed}</span>
              <button className="text-xs text-primary font-bold hover:underline">Download Original</button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default ImageSection;
