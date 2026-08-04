-- Allow admins to update any profile's role
CREATE POLICY "admin_can_update_any_profile" ON profiles
  FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );
