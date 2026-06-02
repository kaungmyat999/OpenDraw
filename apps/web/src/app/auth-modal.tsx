import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { supabase } from '../lib/supabase';
import styles from './auth-modal.module.scss';

export function AuthModal() {
  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h1 className={styles.title}>OpenDraw</h1>
          <p className={styles.subtitle}>Sign in to access your drawing board</p>
        </div>

        <Auth
          supabaseClient={supabase}
          appearance={{
            theme: ThemeSupa,
            variables: {
              default: {
                colors: {
                  brand: '#5e6ad2',
                  brandAccent: '#4a55c0',
                },
                radii: {
                  borderRadiusButton: '6px',
                  inputBorderRadius: '6px',
                },
              },
            },
          }}
          providers={[]}
          redirectTo={window.location.origin}
        />
      </div>
    </div>
  );
}
