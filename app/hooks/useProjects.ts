"use client";

import { useState, useEffect, useCallback } from "react";
import type { Project, Screen, Format } from "../types";

const STORAGE_KEY = "testcraft_projects";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadProjects(): Project[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveProjects(projects: Project[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeScreenId, setActiveScreenId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const p = loadProjects();
    setProjects(p);
    setLoaded(true);
  }, []);

  // Persist whenever projects change (skip initial empty state)
  useEffect(() => {
    if (loaded) saveProjects(projects);
  }, [projects, loaded]);

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const activeScreen = activeProject?.screens.find((s) => s.id === activeScreenId) ?? null;

  // ── Project CRUD ──

  const addProject = useCallback((name: string) => {
    const project: Project = {
      id: generateId(),
      name,
      screens: [],
      createdAt: Date.now(),
    };
    setProjects((prev) => [...prev, project]);
    setActiveProjectId(project.id);
    setActiveScreenId(null);
    return project;
  }, []);

  const renameProject = useCallback((id: string, name: string) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name } : p))
    );
  }, []);

  const deleteProject = useCallback(
    (id: string) => {
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (activeProjectId === id) {
        setActiveProjectId(null);
        setActiveScreenId(null);
      }
    },
    [activeProjectId]
  );

  // ── Screen CRUD ──

  const addScreen = useCallback(
    (projectId: string, name: string) => {
      const screen: Screen = {
        id: generateId(),
        name,
        result: null,
        format: "plain",
        context: "",
        thumbnail: null,
        createdAt: Date.now(),
      };
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? { ...p, screens: [...p.screens, screen] }
            : p
        )
      );
      setActiveScreenId(screen.id);
      return screen;
    },
    []
  );

  const renameScreen = useCallback((projectId: string, screenId: string, name: string) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? {
              ...p,
              screens: p.screens.map((s) =>
                s.id === screenId ? { ...s, name } : s
              ),
            }
          : p
      )
    );
  }, []);

  const deleteScreen = useCallback(
    (projectId: string, screenId: string) => {
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? { ...p, screens: p.screens.filter((s) => s.id !== screenId) }
            : p
        )
      );
      if (activeScreenId === screenId) {
        setActiveScreenId(null);
      }
    },
    [activeScreenId]
  );

  /** Persist the user's context text for a screen (called on every keystroke) */
  const updateScreenContext = useCallback(
    (projectId: string, screenId: string, context: string) => {
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? { ...p, screens: p.screens.map((s) => s.id === screenId ? { ...s, context } : s) }
            : p
        )
      );
    },
    []
  );

  /** Save generated test cases + metadata to a screen */
  const saveScreenResult = useCallback(
    (projectId: string, screenId: string, result: string, format: Format, context: string, thumbnail: string | null) => {
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? {
                ...p,
                screens: p.screens.map((s) =>
                  s.id === screenId
                    ? { ...s, result, format, context, thumbnail }
                    : s
                ),
              }
            : p
        )
      );
    },
    []
  );

  return {
    projects,
    activeProject,
    activeScreen,
    activeProjectId,
    activeScreenId,
    loaded,
    setActiveProjectId,
    setActiveScreenId,
    addProject,
    renameProject,
    deleteProject,
    addScreen,
    renameScreen,
    deleteScreen,
    updateScreenContext,
    saveScreenResult,
  };
}
