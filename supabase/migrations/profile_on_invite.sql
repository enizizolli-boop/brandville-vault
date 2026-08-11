-- When inviteUserByEmail is called, Supabase creates the auth.users row immediately
-- with the role in raw_user_meta_data. This trigger creates the profile right away
-- so it exists by the time the user clicks their invite link and logs in.
-- Only fires when a `role` is present in metadata (invited users), not normal signups.
CREATE OR REPLACE FUNCTION public.handle_invited_user()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.raw_user_meta_data->>'role') IS NOT NULL THEN
    INSERT INTO public.profiles (id, email, full_name, role)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
      NEW.raw_user_meta_data->>'role'
    )
    ON CONFLICT (id) DO UPDATE SET
      role = EXCLUDED.role,
      full_name = COALESCE(EXCLUDED.full_name, profiles.full_name);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_invited ON auth.users;
CREATE TRIGGER on_auth_user_invited
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_invited_user();
