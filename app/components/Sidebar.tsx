"use client";

import { useState } from "react";
import type { Project } from "../types";

interface SidebarProps {
  projects: Project[];
  activeProjectId: string | null;
  activeScreenId: string | null;
  onSelectProject: (id: string) => void;
  onSelectScreen: (projectId: string, screenId: string) => void;
  onAddProject: (name: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
  onAddScreen: (projectId: string, name: string) => void;
  onRenameScreen: (projectId: string, screenId: string, name: string) => void;
  onDeleteScreen: (projectId: string, screenId: string) => void;
  onExportProject: (projectId: string) => void;
  onDeselectScreen: () => void;
}

export default function Sidebar({
  projects,
  activeProjectId,
  activeScreenId,
  onSelectProject,
  onSelectScreen,
  onAddProject,
  onRenameProject,
  onDeleteProject,
  onAddScreen,
  onRenameScreen,
  onDeleteScreen,
  onExportProject,
  onDeselectScreen,
}: SidebarProps) {
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectError, setNewProjectError] = useState("");
  const [showNewProject, setShowNewProject] = useState(false);
  const [newScreenName, setNewScreenName] = useState("");
  const [newScreenError, setNewScreenError] = useState("");
  const [addingScreenFor, setAddingScreenFor] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingScreenKey, setEditingScreenKey] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const MAX_NAME_LEN = 60;

  const toggleExpand = (id: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddProject = () => {
    const name = newProjectName.trim();
    if (!name) { setNewProjectError("Name cannot be empty."); return; }
    onAddProject(name);
    setNewProjectName("");
    setNewProjectError("");
    setShowNewProject(false);
  };

  const handleAddScreen = (projectId: string) => {
    const name = newScreenName.trim();
    if (!name) { setNewScreenError("Name cannot be empty."); return; }
    onAddScreen(projectId, name);
    setNewScreenName("");
    setNewScreenError("");
    setAddingScreenFor(null);
  };

  const startRenameProject = (id: string, currentName: string) => {
    setEditingProjectId(id);
    setEditName(currentName);
  };

  const commitRenameProject = () => {
    if (editingProjectId && editName.trim()) {
      onRenameProject(editingProjectId, editName.trim());
    }
    setEditingProjectId(null);
    setEditName("");
  };

  const startRenameScreen = (projectId: string, screenId: string, currentName: string) => {
    setEditingScreenKey(`${projectId}:${screenId}`);
    setEditName(currentName);
  };

  const commitRenameScreen = (projectId: string, screenId: string) => {
    if (editName.trim()) {
      onRenameScreen(projectId, screenId, editName.trim());
    }
    setEditingScreenKey(null);
    setEditName("");
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-20 w-72 sm:w-64 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col overflow-hidden lg:relative lg:inset-y-auto lg:left-auto lg:z-auto lg:h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Projects</span>
        <button
          onClick={() => setShowNewProject(true)}
          className="w-6 h-6 rounded-lg flex items-center justify-center text-violet-600 hover:bg-violet-50 transition-colors"
          title="New project"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto py-2">
        {projects.length === 0 && !showNewProject && (
          <div className="px-4 py-8 text-center">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: "linear-gradient(135deg, #ede9fe, #ddd6fe)" }}>
              <svg className="w-6 h-6 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <p className="text-xs text-gray-400 mb-3">No projects yet</p>
            <button
              onClick={() => setShowNewProject(true)}
              className="text-xs font-medium text-violet-600 bg-violet-50 px-3 py-1.5 rounded-lg border border-violet-100 hover:bg-violet-100 transition-colors"
            >
              Create your first project
            </button>
          </div>
        )}

        {/* New project input */}
        {showNewProject && (
          <div className="px-3 py-2">
            <div className="flex gap-1.5">
              <input
                autoFocus
                value={newProjectName}
                maxLength={MAX_NAME_LEN}
                onChange={(e) => { setNewProjectName(e.target.value); setNewProjectError(""); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddProject();
                  if (e.key === "Escape") { setShowNewProject(false); setNewProjectName(""); setNewProjectError(""); }
                }}
                placeholder="Project name..."
                className={`flex-1 min-w-0 px-2.5 py-1.5 text-sm text-gray-900 border rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent ${newProjectError ? "border-red-400" : "border-gray-200"}`}
              />
              <button onClick={handleAddProject} className="px-2 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-medium hover:bg-violet-700 transition-colors">
                Add
              </button>
              <button onClick={() => { setShowNewProject(false); setNewProjectName(""); setNewProjectError(""); }} className="px-2 py-1.5 text-gray-400 hover:text-gray-600 text-xs">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            {newProjectError && <p className="text-xs text-red-500 mt-1 px-1">{newProjectError}</p>}
          </div>
        )}

        {projects.map((project) => {
          const isExpanded = expandedProjects.has(project.id) || activeProjectId === project.id;
          const isActive = activeProjectId === project.id;
          const screensWithResults = project.screens.filter((s) => s.result).length;

          return (
            <div key={project.id} className="px-2 mb-1">
              {/* Project row */}
              <div
                className={`flex items-center gap-1.5 px-2 py-2 rounded-lg cursor-pointer transition-all group ${
                  isActive ? "bg-violet-50 text-violet-700" : "hover:bg-gray-50 text-gray-700"
                }`}
                onClick={() => {
                  onSelectProject(project.id);
                  onDeselectScreen();
                  toggleExpand(project.id);
                }}
              >
                {/* Chevron */}
                <svg
                  className={`w-3.5 h-3.5 flex-shrink-0 transition-transform text-gray-400 ${isExpanded ? "rotate-90" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>

                {/* Folder icon */}
                <svg className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-violet-500" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>

                {/* Name (editable or static) */}
                {editingProjectId === project.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRenameProject();
                      if (e.key === "Escape") { setEditingProjectId(null); setEditName(""); }
                    }}
                    onBlur={commitRenameProject}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 text-sm text-gray-900 px-1 py-0 border border-violet-300 rounded focus:outline-none bg-white"
                  />
                ) : (
                  <span className="flex-1 min-w-0 text-sm font-medium truncate" title={project.name}>{project.name}</span>
                )}

                {/* Badge */}
                {screensWithResults > 0 && (
                  <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full flex-shrink-0">
                    {screensWithResults}
                  </span>
                )}

                {/* Actions */}
                <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 flex gap-0.5 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); startRenameProject(project.id, project.name); }}
                    className="p-1 rounded hover:bg-white/80 text-gray-400 hover:text-gray-600"
                    title="Rename"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  </button>
                  {project.screens.some((s) => s.result) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onExportProject(project.id); }}
                      className="p-1 rounded hover:bg-white/80 text-gray-400 hover:text-green-600"
                      title="Export all test cases"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete "${project.name}" and all its screens? This cannot be undone.`)) onDeleteProject(project.id); }}
                    className="p-1 rounded hover:bg-white/80 text-gray-400 hover:text-red-500"
                    title="Delete project"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>

              {/* Screens list */}
              {isExpanded && (
                <div className="ml-5 mt-0.5 border-l border-gray-100 pl-2 space-y-0.5">
                  {project.screens.map((screen) => {
                    const isScreenActive = activeScreenId === screen.id && isActive;
                    const screenKey = `${project.id}:${screen.id}`;
                    return (
                      <div
                        key={screen.id}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all group/screen text-sm ${
                          isScreenActive
                            ? "bg-violet-100 text-violet-700 font-medium"
                            : "text-gray-600 hover:bg-gray-50"
                        }`}
                        onClick={() => {
                          onSelectProject(project.id);
                          onSelectScreen(project.id, screen.id);
                        }}
                      >
                        {/* Screen icon */}
                        {screen.thumbnail ? (
                          <img src={screen.thumbnail} alt="" className="w-5 h-5 rounded object-cover flex-shrink-0 border border-gray-200" />
                        ) : (
                          <svg className={`w-4 h-4 flex-shrink-0 ${isScreenActive ? "text-violet-500" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                        )}

                        {/* Name */}
                        {editingScreenKey === screenKey ? (
                          <input
                            autoFocus
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitRenameScreen(project.id, screen.id);
                              if (e.key === "Escape") { setEditingScreenKey(null); setEditName(""); }
                            }}
                            onBlur={() => commitRenameScreen(project.id, screen.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 min-w-0 text-sm text-gray-900 px-1 py-0 border border-violet-300 rounded focus:outline-none bg-white"
                          />
                        ) : (
                          <span className="flex-1 min-w-0 truncate" title={screen.name}>{screen.name}</span>
                        )}

                        {/* Status dot */}
                        {screen.result && (
                          <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" title="Has test cases" />
                        )}

                        {/* Actions */}
                        <div className="flex-shrink-0 opacity-0 group-hover/screen:opacity-100 flex gap-0.5 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); startRenameScreen(project.id, screen.id, screen.name); }}
                            className="p-0.5 rounded hover:bg-white/80 text-gray-400 hover:text-gray-600"
                            title="Rename"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete screen "${screen.name}"? This cannot be undone.`)) onDeleteScreen(project.id, screen.id); }}
                            className="p-0.5 rounded hover:bg-white/80 text-gray-400 hover:text-red-500"
                            title="Delete screen"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* Add screen button / input */}
                  {addingScreenFor === project.id ? (
                    <div className="px-1 py-1">
                      <div className="flex gap-1">
                        <input
                          autoFocus
                          value={newScreenName}
                          maxLength={MAX_NAME_LEN}
                          onChange={(e) => { setNewScreenName(e.target.value); setNewScreenError(""); }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleAddScreen(project.id);
                            if (e.key === "Escape") { setAddingScreenFor(null); setNewScreenName(""); setNewScreenError(""); }
                          }}
                          placeholder="Screen name..."
                          className={`flex-1 min-w-0 px-2 py-1 text-xs text-gray-900 border rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400 ${newScreenError ? "border-red-400" : "border-gray-200"}`}
                        />
                        <button onClick={() => handleAddScreen(project.id)} className="px-2 py-1 bg-violet-600 text-white rounded-lg text-xs font-medium hover:bg-violet-700">
                          Add
                        </button>
                      </div>
                      {newScreenError && <p className="text-xs text-red-500 mt-1 px-1">{newScreenError}</p>}
                    </div>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setAddingScreenFor(project.id); }}
                      className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-gray-400 hover:text-violet-600 transition-colors w-full rounded-lg hover:bg-violet-50"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add screen
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
