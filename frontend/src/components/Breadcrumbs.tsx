import { Breadcrumbs as MuiBreadcrumbs, Link, Typography, Box } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';

const routeNameMap: Record<string, string> = {
  '': 'Home',
  'lists': 'Lists',
  'saved': 'Saved Words',
  'learned': 'Learned Words',
  'search': 'Search',
  'movie': 'Movies',
  'analyze': 'Analyze',
  'signup': 'Sign Up',
  'login': 'Log In'
};

export default function Breadcrumbs() {
  const location = useLocation();
  const pathnames = location.pathname.split('/').filter((x) => x && x !== 'wordwise');

  if (pathnames.length === 0) {
    return null;
  }

  const state = location.state as { movieTitle?: string } | undefined;

  const breadcrumbItems = [
    <Link
      key="home"
      component={RouterLink}
      to="/"
      underline="hover"
      color="inherit"
      sx={{ display: 'flex', alignItems: 'center' }}
    >
      Home
    </Link>
  ];

  pathnames.forEach((segment, index) => {
    const to = `/${pathnames.slice(0, index + 1).join('/')}`;
    const isLast = index === pathnames.length - 1;
    let label = routeNameMap[segment] || segment;

    if (pathnames[index - 1] === 'movie' && state?.movieTitle) {
      label = state.movieTitle;
    }

    if (isLast) {
      breadcrumbItems.push(
        <Typography key={to} color="text.primary">
          {label}
        </Typography>
      );
    } else {
      breadcrumbItems.push(
        <Link
          key={to}
          component={RouterLink}
          to={to}
          underline="hover"
          color="inherit"
        >
          {label}
        </Link>
      );
    }
  });

  return (
    <Box sx={{ maxWidth: 'lg', mx: 'auto', width: '100%', px: 3, pt: 2, pb: 1 }}>
      <MuiBreadcrumbs separator={<NavigateNextIcon fontSize="small" />} aria-label="breadcrumb">
        {breadcrumbItems}
      </MuiBreadcrumbs>
    </Box>
  );
}
