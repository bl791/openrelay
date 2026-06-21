import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import { AppHeader } from '@/components/AppHeader';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppHeader />
      <Container maxWidth="lg" sx={{ px: 3, py: 4 }}>
        {children}
      </Container>
    </Box>
  );
}
