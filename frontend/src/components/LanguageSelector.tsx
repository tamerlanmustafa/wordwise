import {
  FormControl,
  Select,
  MenuItem,
  InputLabel,
  Stack,
  Typography,
  Box,
  type SelectChangeEvent
} from '@mui/material';
import TranslateIcon from '@mui/icons-material/Translate';
import { useLanguage } from '../contexts/LanguageContext';

interface LanguageSelectorProps {
  variant?: 'standard' | 'outlined' | 'filled';
  size?: 'small' | 'medium';
  showLabel?: boolean;
  fullWidth?: boolean;
}

export default function LanguageSelector({
  variant = 'outlined',
  size = 'small',
  showLabel = true,
  fullWidth = false
}: LanguageSelectorProps) {
  const { targetLanguage, setTargetLanguage, availableLanguages } = useLanguage();

  const handleChange = (event: SelectChangeEvent) => {
    setTargetLanguage(event.target.value);
  };

  return (
    <FormControl variant={variant} size={size} fullWidth={fullWidth}>
      {showLabel && <InputLabel id="language-selector-label">Translation Language</InputLabel>}
      <Select
        labelId="language-selector-label"
        id="language-selector"
        value={targetLanguage}
        label={showLabel ? "Translation Language" : undefined}
        onChange={handleChange}
        startAdornment={
          <TranslateIcon sx={{ mr: 1, color: 'action.active', fontSize: 20 }} />
        }
      >
        {availableLanguages.map((lang) => (
          <MenuItem key={lang.code} value={lang.code}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box
                component="span"
                sx={{
                  fontWeight: 'medium',
                  minWidth: 30,
                  color: 'primary.main'
                }}
              >
                {lang.code}
              </Box>
              <Typography variant="body2">
                {lang.nativeName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                ({lang.name})
              </Typography>
            </Stack>
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
