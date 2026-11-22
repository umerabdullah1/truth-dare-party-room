CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can create their own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
      NULLIF(NEW.raw_user_meta_data ->> 'name', ''),
      NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
      'Friend'
    ),
    NULLIF(NEW.raw_user_meta_data ->> 'avatar_url', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile();

CREATE OR REPLACE FUNCTION public.is_truth_dare_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(auth.jwt() ->> 'email' = 'u96598999@gmail.com', false)
$$;
REVOKE ALL ON FUNCTION public.is_truth_dare_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_truth_dare_admin() TO authenticated;

CREATE TABLE public.game_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('truth', 'dare')),
  prompt text NOT NULL CHECK (char_length(trim(prompt)) BETWEEN 4 AND 240),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, prompt)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_prompts TO authenticated;
GRANT ALL ON public.game_prompts TO service_role;
ALTER TABLE public.game_prompts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Only the admin can read prompts" ON public.game_prompts FOR SELECT TO authenticated USING (public.is_truth_dare_admin());
CREATE POLICY "Only the admin can add prompts" ON public.game_prompts FOR INSERT TO authenticated WITH CHECK (public.is_truth_dare_admin());
CREATE POLICY "Only the admin can update prompts" ON public.game_prompts FOR UPDATE TO authenticated USING (public.is_truth_dare_admin()) WITH CHECK (public.is_truth_dare_admin());
CREATE POLICY "Only the admin can remove prompts" ON public.game_prompts FOR DELETE TO authenticated USING (public.is_truth_dare_admin());

INSERT INTO public.game_prompts (kind, prompt) VALUES
  ('truth', 'What is a small thing that always makes your day better?'),
  ('truth', 'What song do you know almost every word to?'),
  ('truth', 'What is a food combination you secretly love?'),
  ('truth', 'What is something you are proud of learning?'),
  ('truth', 'What was your most memorable birthday?'),
  ('truth', 'If you could instantly master one hobby, what would it be?'),
  ('truth', 'What is the funniest thing that happened to you this week?'),
  ('truth', 'Which fictional character would make a great friend?'),
  ('truth', 'What is one place you would love to visit with friends?'),
  ('truth', 'What harmless fear did you have as a child?'),
  ('dare', 'Do your best dramatic movie-trailer voice for the next round.'),
  ('dare', 'Invent a two-line theme song for the person on your left.'),
  ('dare', 'Give everyone in the room a cheerful compliment.'),
  ('dare', 'Act like a sports commentator describing someone taking a sip of water.'),
  ('dare', 'Hum a song and let the group guess it.'),
  ('dare', 'Show your best slow-motion victory celebration.'),
  ('dare', 'Speak in a robot voice until your next turn.'),
  ('dare', 'Make up a new handshake with another player.'),
  ('dare', 'Tell a one-minute story using three random objects nearby.'),
  ('dare', 'Strike a superhero pose and hold it for five seconds.');

CREATE TABLE public.game_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code text NOT NULL UNIQUE,
  room_name text NOT NULL CHECK (char_length(trim(room_name)) BETWEEN 2 AND 40),
  host_secret text NOT NULL,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing')),
  turn_number integer NOT NULL DEFAULT 0,
  current_player_id uuid,
  current_kind text CHECK (current_kind IS NULL OR current_kind IN ('truth', 'dare')),
  current_prompt text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.game_rooms TO service_role;
ALTER TABLE public.game_rooms ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.game_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  nickname text NOT NULL CHECK (char_length(trim(nickname)) BETWEEN 2 AND 24),
  joined_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.game_players TO service_role;
ALTER TABLE public.game_players ENABLE ROW LEVEL SECURITY;
CREATE INDEX game_players_room_joined_idx ON public.game_players (room_id, joined_at, id);

CREATE OR REPLACE FUNCTION public.create_game_room(p_room_name text, p_host_nickname text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id uuid;
  v_invite_code text;
  v_host_secret text;
  v_host_player_id uuid;
BEGIN
  IF char_length(trim(COALESCE(p_room_name, ''))) NOT BETWEEN 2 AND 40 THEN
    RAISE EXCEPTION 'Room name must be between 2 and 40 characters.';
  END IF;
  IF char_length(trim(COALESCE(p_host_nickname, ''))) NOT BETWEEN 2 AND 24 THEN
    RAISE EXCEPTION 'Nickname must be between 2 and 24 characters.';
  END IF;
  v_room_id := gen_random_uuid();
  v_invite_code := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  v_host_secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  INSERT INTO public.game_rooms (id, invite_code, room_name, host_secret)
  VALUES (v_room_id, v_invite_code, trim(p_room_name), v_host_secret);
  INSERT INTO public.game_players (room_id, nickname)
  VALUES (v_room_id, trim(p_host_nickname))
  RETURNING id INTO v_host_player_id;
  RETURN jsonb_build_object(
    'room_id', v_room_id,
    'invite_code', v_invite_code,
    'host_secret', v_host_secret,
    'host_player_id', v_host_player_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.join_game_room(p_invite_code text, p_nickname text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id uuid;
  v_player_id uuid;
BEGIN
  IF char_length(trim(COALESCE(p_nickname, ''))) NOT BETWEEN 2 AND 24 THEN
    RAISE EXCEPTION 'Nickname must be between 2 and 24 characters.';
  END IF;
  SELECT id INTO v_room_id FROM public.game_rooms
  WHERE invite_code = lower(trim(COALESCE(p_invite_code, '')));
  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'That room link is not valid.';
  END IF;
  INSERT INTO public.game_players (room_id, nickname)
  VALUES (v_room_id, trim(p_nickname))
  RETURNING id INTO v_player_id;
  RETURN jsonb_build_object('player_id', v_player_id, 'room_id', v_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_game_room(p_invite_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.game_rooms%ROWTYPE;
  v_players jsonb;
BEGIN
  SELECT * INTO v_room FROM public.game_rooms
  WHERE invite_code = lower(trim(COALESCE(p_invite_code, '')));
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('id', p.id, 'nickname', p.nickname) ORDER BY p.joined_at, p.id),
    '[]'::jsonb
  ) INTO v_players
  FROM public.game_players p WHERE p.room_id = v_room.id;
  RETURN jsonb_build_object(
    'id', v_room.id,
    'invite_code', v_room.invite_code,
    'room_name', v_room.room_name,
    'status', v_room.status,
    'turn_number', v_room.turn_number,
    'current_player_id', v_room.current_player_id,
    'current_kind', v_room.current_kind,
    'current_prompt', v_room.current_prompt,
    'players', v_players
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_game_turn(p_invite_code text, p_host_secret text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.game_rooms%ROWTYPE;
  v_player_id uuid;
  v_prompt_kind text;
  v_prompt text;
  v_player_count integer;
BEGIN
  SELECT * INTO v_room FROM public.game_rooms
  WHERE invite_code = lower(trim(COALESCE(p_invite_code, '')))
  FOR UPDATE;
  IF NOT FOUND OR v_room.host_secret IS DISTINCT FROM p_host_secret THEN
    RAISE EXCEPTION 'Only this room’s host can deal the next turn.';
  END IF;
  SELECT count(*) INTO v_player_count FROM public.game_players WHERE room_id = v_room.id;
  IF v_player_count < 2 THEN
    RAISE EXCEPTION 'Invite at least one friend before starting.';
  END IF;
  SELECT id INTO v_player_id FROM public.game_players
  WHERE room_id = v_room.id
  ORDER BY joined_at, id
  OFFSET (v_room.turn_number % v_player_count)
  LIMIT 1;
  SELECT kind, prompt INTO v_prompt_kind, v_prompt
  FROM public.game_prompts
  WHERE active = true
  ORDER BY random()
  LIMIT 1;
  IF v_prompt IS NULL THEN
    RAISE EXCEPTION 'The prompt library is empty. Ask the admin to add prompts.';
  END IF;
  UPDATE public.game_rooms
  SET status = 'playing',
      turn_number = turn_number + 1,
      current_player_id = v_player_id,
      current_kind = v_prompt_kind,
      current_prompt = v_prompt
  WHERE id = v_room.id;
  RETURN public.get_game_room(v_room.invite_code);
END;
$$;

REVOKE ALL ON FUNCTION public.create_game_room(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_game_room(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_game_room(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.advance_game_turn(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_game_room(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_game_room(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_game_room(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_game_turn(text, text) TO anon, authenticated;