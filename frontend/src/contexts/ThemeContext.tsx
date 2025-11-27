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

          primary: {
            main: "#b59fe1ff",                // WordWise green
            light: "#76DA4B",               // light version for hover/focus
            dark: "#2E7A0F",                // darker version for hover
            contrastText: "#ffffff",        // white text on green button
          },

          secondary: {
            main: "#dc004e",
          },

          background: {
            default: mode === "light" ? "#FFFDF6" : "#1A2330",
            paper:   mode === "light" ? "#FFFFFF" : "#212A37",
          },

          text: {
            primary:   mode === "light" ? "#1A1A1A" : "#E6E6E6",
            secondary: mode === "light" ? "#555"    : "#A0A0A0",
            disabled:  mode === "light" ? "#9E9E9E" : "#6F6F6F",
          },

          divider: mode === "light" ? "#E0E0E0" : "#3A4552",

          action: {
            hover:    mode === "light" ? "#F3F4F6" : "#2B3340",
            selected: mode === "light" ? "#E5E7EB" : "#3A4552",
            disabled: mode === "light" ? "#CCCCCC" : "#555",
            active:   mode === "light" ? "#4BB819" : "#76DA4B",
          }
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
