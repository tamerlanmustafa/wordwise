import { Container, Box, Typography, Grid, Card, CardContent, Stack, Chip } from '@mui/material';
import { Link } from 'react-router-dom';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useState, useEffect } from 'react';
import axios from 'axios';

export default function AllListsPage() {
  const [savedCount, setSavedCount] = useState(0);
  const [learnedCount, setLearnedCount] = useState(0);

  const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

  useEffect(() => {
    fetchCounts();
  }, []);

  const fetchCounts = async () => {
    try {
      const token = localStorage.getItem('wordwise_token');
      const response = await axios.get(`${API_BASE_URL}/user/words/`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const words = response.data;
      setSavedCount(words.length);
      setLearnedCount(words.filter((w: any) => w.is_learned).length);
    } catch (error) {
      console.error('Failed to fetch counts:', error);
    }
  };

  const lists = [
    {
      name: 'Saved Words',
      path: '/lists/saved',
      icon: <BookmarkIcon sx={{ fontSize: 40, color: 'warning.main' }} />,
      count: savedCount,
      description: 'All words you have saved from movies'
    },
    {
      name: 'Learned Words',
      path: '/lists/learned',
      icon: <CheckCircleIcon sx={{ fontSize: 40, color: 'success.main' }} />,
      count: learnedCount,
      description: 'Words you have marked as learned'
    }
  ];

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" fontWeight="bold" gutterBottom sx={{ mb: 4 }}>
        My Lists
      </Typography>

      <Grid container spacing={3}>
        {lists.map((list) => (
          <Grid item xs={12} sm={6} md={4} key={list.path}>
            <Card
              component={Link}
              to={list.path}
              sx={{
                textDecoration: 'none',
                height: '100%',
                transition: 'transform 0.2s, box-shadow 0.2s',
                '&:hover': {
                  transform: 'translateY(-4px)',
                  boxShadow: 6
                }
              }}
            >
              <CardContent>
                <Stack spacing={2}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {list.icon}
                    <Chip label={list.count} color="primary" />
                  </Box>
                  <Typography variant="h6" fontWeight={600}>
                    {list.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {list.description}
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Container>
  );
}
