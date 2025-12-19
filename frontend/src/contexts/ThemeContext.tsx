import { createContext, useContext, useState, useMemo, type ReactNode } from "react";
import {
  ThemeProvider as MuiThemeProvider,
  createTheme,
  CssBaseline,
} from "@mui/material";

// Extend MUI theme types for custom wordRow palette
declare module '@mui/material/styles' {
  interface Palette {
    wordRow: {
      expandedBg: string;
      hoverBg: string;
      panelBg: string;
      panelBorder: string;
    };
  }
  interface PaletteOptions {
    wordRow?: {
      expandedBg?: string;
      hoverBg?: string;
      panelBg?: string;
      panelBorder?: string;
    };
  }
}

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

          // Main brand color - soft purple
          primary: {
            main: "#7C5CBF",
            light: "#9B7ED9",
            dark: "#5A3D99",
            contrastText: "#ffffff",
          },

          // Accent - warm coral
          secondary: {
            main: "#E07A5F",
            light: "#E99A85",
            dark: "#C45D42",
            contrastText: "#ffffff",
          },

          // Success - soft teal
          success: {
            main: "#4CAF9A",
            light: "#7AC4B5",
            dark: "#358F7D",
          },

          // Warning - warm amber
          warning: {
            main: "#F4A261",
            light: "#F7BC8C",
            dark: "#D88A42",
          },

          // Info - calm blue
          info: {
            main: "#5E9ED6",
            light: "#8CBDE8",
            dark: "#3D7AB8",
          },

          // Error - muted red
          error: {
            main: "#D66A6A",
            light: "#E39393",
            dark: "#B84C4C",
          },

          background: {
            default: mode === "light" ? "#FAFAF8" : "#1A1D24",
            paper: mode === "light" ? "#FFFFFF" : "#22262F",
          },

          text: {
            primary: mode === "light" ? "#2D3142" : "#E8E8EC",
            secondary: mode === "light" ? "#5C6378" : "#9CA3B4",
            disabled: mode === "light" ? "#A0A4B0" : "#5C6378",
          },

          divider: mode === "light" ? "#E8E8EC" : "#333842",

          action: {
            hover: mode === "light" ? "#F5F5F3" : "#2A2F3A",
            selected: mode === "light" ? "#EEEEF0" : "#333842",
            disabled: mode === "light" ? "#C8CAD0" : "#4A4F5C",
            active: mode === "light" ? "#7C5CBF" : "#9B7ED9",
          },

          // Custom colors for word list UI
          wordRow: {
            expandedBg: mode === "light" ? "#F8F6FC" : "#2A2840",
            hoverBg: mode === "light" ? "#F5F3FA" : "#262438",
            panelBg: mode === "light" ? "#F0EDF8" : "#1E1C2A",
            panelBorder: mode === "light" ? "#E0DBF0" : "#3A3650",
          },
        },

        typography: {
          fontFamily: `"Inter", "Roboto", "Helvetica", "Arial", sans-serif`,
        },

        shape: {
          borderRadius: 8,
        },

        components: {
          MuiPaper: {
            styleOverrides: {
              root: {
                backgroundImage: 'none',
              },
            },
          },
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
