import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { bootstrapAssets } from './assets/index.js';

// 必须在渲染前注册真实素材包：否则 activePack 恒为 placeholder，全屏占位图。
bootstrapAssets();

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');
createRoot(el).render(<App />);
