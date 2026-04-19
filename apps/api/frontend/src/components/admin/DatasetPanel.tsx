import React, { useState, useEffect } from 'react';
import { Database, Upload, Trash2, Folder, ExternalLink } from 'lucide-react';
import { type KnowledgeDataset } from '../../types';
import axios from 'axios';

const DatasetPanel = () => {
  const [datasets, setDatasets] = useState<KnowledgeDataset[]>([]);
  const [datasetDir, setDatasetDir] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchDatasets();
  }, []);

  const fetchDatasets = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const res = await axios.get('/api/datasets', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setDatasets(res.data.datasets || []);
      setDatasetDir(res.data.dataset_dir || '');
    } catch (e: unknown) {
      console.error('Failed to fetch datasets:', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-fade-up">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center text-primary">
            <Database size={20} />
          </div>
          <div>
            <h3 className="text-xl font-bold">Knowledge Curation</h3>
            <p className="text-xs text-text3 font-mono">{datasetDir}</p>
          </div>
        </div>
        <button className="primary-btn px-4 py-2">
          <Upload size={16} /> Upload Dataset
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {datasets.map((ds, i) => (
          <div key={i} className="glass-panel p-5 rounded-premium space-y-4 hover:border-primary/50 transition-all group">
            <div className="flex items-start justify-between">
              <div className="p-3 bg-surface2 rounded-xl text-primary">
                <Folder size={24} />
              </div>
              <button className="p-2 text-text3 hover:text-error transition-all opacity-0 group-hover:opacity-100">
                <Trash2 size={16} />
              </button>
            </div>
            
            <div>
              <h5 className="font-bold text-text truncate">{ds.name}</h5>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] font-bold text-text3 uppercase">{ds.size_mb ? ds.size_mb.toFixed(2) : '0'} MB</span>
                <span className="text-[10px] font-bold text-primary uppercase">{ds.item_count || 0} ITEMS</span>
              </div>
            </div>

            <button className="w-full flex items-center justify-center gap-2 py-2 text-xs font-bold text-text2 bg-bg rounded-lg hover:text-primary border border-border transition-all">
              <ExternalLink size={14} /> Open Records
            </button>
          </div>
        ))}

        {datasets.length === 0 && !loading && (
          <div className="col-span-full py-20 text-center border-2 border-dashed border-border rounded-premium">
            <p className="text-text3 text-sm italic">No knowledge bases detected in primary storage.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DatasetPanel;
