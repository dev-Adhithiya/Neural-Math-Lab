import React from 'react';

const ITEMS = [
  { id: 'chat', label: 'AI Chat', icon: '💬' },
  { id: 'quiz', label: 'Take a Quiz', icon: '🏆' },
  { id: 'plan', label: 'Plan My Session', icon: '🗓️' },
  { id: 'prereq', label: 'Check Pre-reqs', icon: '🔗' },
  { id: 'report', label: 'My Report', icon: '📊' },
  { id: 'map', label: 'Math Topic Map', icon: '🗺️' },
  { id: 'mistakes', label: 'Mistakes', icon: '🧾' },
];

export default function SidebarNav({ activeView, onNavigate, collapsed = false }) {
  return (
    <div className={`sidebar-nav ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-nav-items">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            className={`sidebar-nav-item ${activeView === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
            title={item.label}
            aria-label={item.label}
          >
            <span className="sidebar-nav-icon">{item.icon}</span>
            {!collapsed && <span className="sidebar-nav-label">{item.label}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

