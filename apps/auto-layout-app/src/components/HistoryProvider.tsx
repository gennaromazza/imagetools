import { createContext, useContext, useReducer, useCallback } from "react";
import type { AutoLayoutResult } from "@photo-tools/shared-types";

interface HistoryState {
  past: AutoLayoutResult[];
  present: AutoLayoutResult;
  future: AutoLayoutResult[];
}

interface HistoryAction {
  type: "UNDO" | "REDO" | "PUSH" | "RESET";
  payload?: AutoLayoutResult;
}

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "PUSH":
      if (!action.payload) return state;
      return {
        past: [...state.past, state.present],
        present: action.payload,
        future: []
      };
    case "UNDO":
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      const newPast = state.past.slice(0, -1);
      return {
        past: newPast,
        present: previous,
        future: [state.present, ...state.future]
      };
    case "REDO":
      if (state.future.length === 0) return state;
      const next = state.future[0];
      const newFuture = state.future.slice(1);
      return {
        past: [...state.past, state.present],
        present: next,
        future: newFuture
      };
    case "RESET":
      if (!action.payload) return state;
      return {
        past: [],
        present: action.payload,
        future: []
      };
    default:
      return state;
  }
}

interface HistoryContextType {
  state: HistoryState;
  canUndo: boolean;
  canRedo: boolean;
  push: (result: AutoLayoutResult) => void;
  undo: () => void;
  redo: () => void;
  reset: (result: AutoLayoutResult) => void;
}

const HistoryContext = createContext<HistoryContextType | null>(null);

export function HistoryProvider({
  children,
  initialResult
}: {
  children: React.ReactNode;
  initialResult: AutoLayoutResult;
}) {
  const [state, dispatch] = useReducer(historyReducer, {
    past: [],
    present: initialResult,
    future: []
  });

  const push = useCallback((result: AutoLayoutResult) => {
    dispatch({ type: "PUSH", payload: result });
  }, []);

  const undo = useCallback(() => {
    dispatch({ type: "UNDO" });
  }, []);

  const redo = useCallback(() => {
    dispatch({ type: "REDO" });
  }, []);

  const reset = useCallback((result: AutoLayoutResult) => {
    dispatch({ type: "RESET", payload: result });
  }, []);

  const value: HistoryContextType = {
    state,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    push,
    undo,
    redo,
    reset
  };

  return (
    <HistoryContext.Provider value={value}>
      {children}
    </HistoryContext.Provider>
  );
}

export function useHistory() {
  const context = useContext(HistoryContext);
  if (!context) {
    throw new Error("useHistory must be used within a HistoryProvider");
  }
  return context;
}