import React from 'react';
import { TOPICS, getTopicsByCategory } from '../agents/KnowledgeGraph.js';

/**
 * TopicSelector — Visual topic graph with locked/unlocked states.
 *
 * @param {Object} props
 * @param {Array}  props.annotatedTopics - From getAnnotatedTopics()
 * @param {string} [props.selectedTopic]
 * @param {Function} props.onSelect
 */
export default function TopicSelector({ annotatedTopics = [], selectedTopic, onSelect }) {
  const categories = {};
  for (const topic of annotatedTopics) {
    if (!categories[topic.category]) categories[topic.category] = [];
    categories[topic.category].push(topic);
  }

  // Fallback if no annotated topics
  if (annotatedTopics.length === 0) {
    const cats = getTopicsByCategory();
    Object.keys(cats).forEach((cat) => {
      categories[cat] = cats[cat].map((t) => ({
        ...t,
        status: t.prerequisites.length === 0 ? 'unlocked' : 'locked',
        unlocked: t.prerequisites.length === 0,
        missing: t.prerequisites,
      }));
    });
  }

  const getStatusStyles = (status) => {
    switch (status) {
      case 'mastered':
        return { className: 'mastered', icon: '🏆', tooltip: 'Mastered!' };
      case 'in-progress':
        return { className: 'in-progress', icon: '📖', tooltip: 'In Progress' };
      case 'unlocked':
        return { className: 'unlocked', icon: '🔓', tooltip: 'Ready to Learn' };
      case 'locked':
      default:
        return { className: 'locked', icon: '🔒', tooltip: 'Prerequisites Required' };
    }
  };

  const categoryIcons = {
    Foundations: '🧱',
    Algebra: '📐',
    Geometry: '📏',
    Trigonometry: '📊',
    Analysis: '📈',
    Calculus: '∫',
    Statistics: '🎲',
  };

  return (
    <div className="topic-selector">
      <h3 className="topic-selector-title">
        <span>📚</span> Topics
      </h3>
      {Object.entries(categories).map(([category, topics]) => (
        <div key={category} className="topic-category">
          <h4 className="category-title">
            <span>{categoryIcons[category] || '📘'}</span>
            {category}
          </h4>
          <div className="topic-list">
            {topics.map((topic) => {
              const style = getStatusStyles(topic.status);
              const isSelected = selectedTopic === topic.id;
              const isClickable = topic.status !== 'locked';

              return (
                <button
                  key={topic.id}
                  className={`topic-item ${style.className} ${isSelected ? 'selected' : ''}`}
                  onClick={() => isClickable && onSelect(topic.id)}
                  disabled={!isClickable}
                  title={
                    topic.status === 'locked'
                      ? `Requires: ${topic.missing?.map((m) => {
                          const t = TOPICS.find((t) => t.id === m);
                          return t?.label || m;
                        }).join(', ')}`
                      : style.tooltip
                  }
                >
                  <span className="topic-icon">{style.icon}</span>
                  <span className="topic-label">{topic.label}</span>
                  <span className="topic-tier">T{topic.tier}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
