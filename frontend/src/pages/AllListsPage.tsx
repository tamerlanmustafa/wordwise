import { Container, Box, Typography, List, ListItemButton, ListItemIcon, ListItemText, Chip, Divider } from '@mui/material';
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
      icon: <BookmarkIcon sx={{ color: 'warning.main' }} />,
      count: savedCount,
      description: 'All words you have saved from movies'
    },
    {
      name: 'Learned Words',
      path: '/lists/learned',
      icon: <CheckCircleIcon sx={{ color: 'success.main' }} />,
      count: learnedCount,
      description: 'Words you have marked as learned'
    }
  ];

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" fontWeight="bold" gutterBottom sx={{ mb: 3 }}>
        My Lists
      </Typography>

      <List sx={{ width: '100%', bgcolor: 'background.paper', borderRadius: 2, boxShadow: 2 }}>
        {lists.map((list, index) => (
          <Box key={list.path}>
            <ListItemButton
              component={Link}
              to={list.path}
              sx={{
                py: 2,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                {list.icon}
              </ListItemIcon>

              <ListItemText
                primary={
                  <Typography variant="subtitle1" fontWeight={600}>
                    {list.name}
                  </Typography>
                }
                secondary={
                  <Typography variant="body2" color="text.secondary">
                    {list.description}
                  </Typography>
                }
              />

              <Chip label={list.count} color="primary" sx={{ ml: 2 }} />
            </ListItemButton>

            {index < lists.length - 1 && <Divider />}
          </Box>
        ))}
      </List>
    </Container>
  );
}
