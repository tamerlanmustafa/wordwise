import { createContext, useContext, useState, useMemo, type ReactNode } from "react";
import {
  ThemeProvider as MuiThemeProvider,
  createTheme,
  CssBaseline,
} from "@mui/material";

interface ThemeContextType {
  mode: "light" | "dark";
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [mode, setMode] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("wordwise_theme_mode");
    return (saved as "light" | "dark") || "light";
  });

  const toggleTheme = () => {
    setMode((prevMode) => {
      const newMode = prevMode === "light" ? "dark" : "light";
      localStorage.setItem("wordwise_theme_mode", newMode);
      return newMode;
    });
  };

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode,

          // Brand colors
          primary: {
            main: "#B0DB9C", // WordWise green
          },
          secondary: {
            main: "#dc004e",
          },

          // GLOBAL BACKGROUND COLORS
          background: {
            default: mode === "light" ? "#FFFDF6" : "#212A37", // root background (body)
            paper: mode === "light" ? "#FFFDF6" : "#212A37", // Cards, Paper elements
          },

          // GLOBAL TEXT COLORS
          text: {
            primary: mode === "light" ? "#1A1A1A" : "#E6E6E6",
            secondary: mode === "light" ? "#555" : "#A0A0A0",
          },
        },

        typography: {
          fontFamily: `"Roboto", "Helvetica", "Arial", sans-serif`,
        },

        // Optional: global shape / border radius customization
        shape: {
          borderRadius: 10,
        },
      }),
    [mode]
  );

  return (
    <ThemeContext.Provider value={{ mode, toggleTheme }}>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
