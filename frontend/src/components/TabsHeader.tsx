import { memo, useMemo } from 'react';
import { Box, Paper, Tabs, Tab, Typography, Stack } from '@mui/material';

interface CEFRGroup {
  level: string;
  description: string;
  color: string;
  wordCount: number;
}

interface TabsHeaderProps {
  groups: CEFRGroup[];
  activeTab: number;
  onTabChange: (_: React.SyntheticEvent, newValue: number) => void;
  scrolledPastTop: boolean;
  showTopBar: boolean;
}

// Memoized TabsHeader - only re-renders when activeTab changes
export const TabsHeader = memo<TabsHeaderProps>(({
  groups,
  activeTab,
  onTabChange,
  scrolledPastTop,
  showTopBar
}) => {
  // Memoize the active group color to prevent recalculations
  const activeColor = useMemo(() => groups[activeTab]?.color || '#4caf50', [groups, activeTab]);

  // Memoize indicator position for CSS transform - zero JavaScript overhead
  const indicatorTransform = useMemo(() =>
    `translateX(${activeTab * 100}%)`,
    [activeTab]
  );

  const indicatorWidth = useMemo(() =>
    `${100 / groups.length}%`,
    [groups.length]
  );

  return (
    <Box
      sx={{
        position: 'sticky',
        top: '72px', // Fixed position
        zIndex: 1100,
        transform: showTopBar ? 'translateY(0)' : 'translateY(-48px)',
        transition: 'transform 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)',
        // backgroundColor: 'background.default',
        mb: 3,
        mx: 1,
        // Prevent layout shift by fixing dimensions
        willChange: 'transform', // GPU optimization
      }}
    >
      <Paper
        elevation={2}
        sx={{
          borderRadius: '16px',
          // Memoize box shadow to prevent recalculation
          boxShadow: scrolledPastTop
            ? '0px 4px 12px rgba(0, 0, 0, 0.09)'
            : 'none',
          transition: 'box-shadow 0.3s ease',
          position: 'relative',
          overflow: 'hidden',
          // Prevent layout thrashing
          contain: 'layout style paint',
          '&::before': {
            content: '""',
            position: 'absolute',
            inset: 0,
            borderRadius: '16px',
            padding: '2px',
            background: 'linear-gradient(90deg, #ff6b6b, #4ecdc4, #45b7d1, #96ceb4, #ffeaa7, #fd79a8, #a29bfe, #6c5ce7, #ff6b6b)',
            backgroundSize: '400% 100%',
            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            animation: 'gradient-shift 15s linear infinite',
            pointerEvents: 'none'
          },
          '@keyframes gradient-shift': {
            '0%': {
              backgroundPosition: '0% 50%'
            },
            '100%': {
              backgroundPosition: '400% 50%'
            }
          }
        }}
      >
        <Box sx={{ position: 'relative' }}>
          {/* Animated background indicator - pure CSS for zero JS overhead */}
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: indicatorWidth,
              height: '100%',
              zIndex: 0,
              pointerEvents: 'none',
              borderRadius: '14px',
              backgroundColor: `${activeColor}15`,
              // GPU-accelerated transform - zero layout recalculation
              transform: indicatorTransform,
              transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.3s ease',
              willChange: 'transform'
            }}
          />

          <Tabs
            value={activeTab}
            onChange={onTabChange}
            variant="scrollable"
            scrollButtons={false}
            sx={{
              px: 0,
              py: 0,
              position: 'relative',
              zIndex: 1,
              '& .MuiTabs-indicator': { display: 'none' },
              '& .MuiTabs-flexContainer': {
                display: 'flex',
                justifyContent: 'space-between',
                width: '100%',
              },
              '& .MuiTab-root': {
                flex: 1,
                minWidth: 0,
                padding: 0,
              }
            }}
          >
            {groups.map((group, index) => (
              <Tab
                key={group.level}
                disableRipple
                sx={{
                  color: 'text.secondary',
                  border: '1px solid rgba(0,0,0,0.08)',
                  borderRight: index === groups.length - 1 ? '1px solid rgba(0,0,0,0.08)' : 'none',
                  position: 'relative',
                  // Only animate cheap properties (opacity, color)
                  transition: 'opacity 200ms ease-in-out, color 200ms ease-in-out',
                  backgroundColor: 'transparent',
                  borderRadius: '14px',
                  overflow: 'hidden',
                  opacity: activeTab === index ? 1 : 0.6,
                  // GPU acceleration
                  willChange: 'opacity',
                  '&.Mui-selected': {
                    color: group.color,
                    opacity: 1
                  }
                }}
                label={
                  <Box
                    sx={{
                      position: 'relative',
                      padding: '6px 20px',
                    }}
                  >
                    <Stack direction="column" spacing={0} alignItems="center">
                      <Typography
                        variant="h5"
                        sx={{
                          fontWeight: 700,
                        }}
                      >
                        {group.level}
                      </Typography>
                    </Stack>
                  </Box>
                }
              />
            ))}
          </Tabs>
        </Box>
      </Paper>
    </Box>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if these specific props change
  return (
    prevProps.activeTab === nextProps.activeTab &&
    prevProps.scrolledPastTop === nextProps.scrolledPastTop &&
    prevProps.showTopBar === nextProps.showTopBar &&
    prevProps.groups.length === nextProps.groups.length
  );
});

TabsHeader.displayName = 'TabsHeader';
