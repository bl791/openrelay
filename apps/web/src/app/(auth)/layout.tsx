import Box from '@mui/material/Box';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="main"
      sx={{
        display: 'flex',
        minHeight: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        px: 3,
        py: 6,
      }}
    >
      {children}
    </Box>
  );
}
