-- Truth or Dare: run this ONCE in your database's SQL editor.
-- Safe to run again; it only creates or replaces things.

-- 1) ADMIN FIX ---------------------------------------------------------------
-- The admin role was only granted when your Google account was first created.
-- If you signed in before that rule existed, you have no role and /admin denies you.
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users
WHERE lower(email) = 'u96598999@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

-- 2) TRUTH OR DARE CHOICE ----------------------------------------------------
-- A new turn now starts with NO prompt; the player whose turn it is picks truth or dare.
CREATE OR REPLACE FUNCTION public.deal_next_turn(p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.game_rooms%ROWTYPE;
  v_count integer;
  v_player uuid;
BEGIN
  SELECT * INTO v_room FROM public.game_rooms WHERE id = p_room_id FOR UPDATE;
  SELECT count(*) INTO v_count FROM public.game_players WHERE room_id = p_room_id;
  IF v_count < 2 THEN
    RAISE EXCEPTION 'Invite at least one friend before starting.';
  END IF;
  SELECT id INTO v_player FROM public.game_players
  WHERE room_id = p_room_id
  ORDER BY joined_at, id
  OFFSET (v_room.turn_number % v_count)
  LIMIT 1;
  UPDATE public.game_rooms
  SET status = 'playing',
      turn_number = turn_number + 1,
      current_player_id = v_player,
      current_kind = NULL,
      current_prompt = NULL
  WHERE id = p_room_id;
END;
$$;
REVOKE ALL ON FUNCTION public.deal_next_turn(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.advance_game_turn(p_invite_code text, p_host_secret text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.game_rooms%ROWTYPE;
BEGIN
  SELECT * INTO v_room FROM public.game_rooms
  WHERE invite_code = lower(trim(COALESCE(p_invite_code, '')))
  FOR UPDATE;
  IF NOT FOUND OR v_room.host_secret IS DISTINCT FROM p_host_secret THEN
    RAISE EXCEPTION 'Only this room’s host can deal the next turn.';
  END IF;
  PERFORM public.deal_next_turn(v_room.id);
  RETURN public.get_game_room(v_room.invite_code);
END;
$$;

-- The player whose turn it is picks truth or dare and the bot deals a prompt of that kind.
CREATE OR REPLACE FUNCTION public.choose_game_prompt(p_invite_code text, p_player_id uuid, p_kind text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.game_rooms%ROWTYPE;
  v_prompt text;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('truth', 'dare') THEN
    RAISE EXCEPTION 'Pick truth or dare.';
  END IF;
  SELECT * INTO v_room FROM public.game_rooms
  WHERE invite_code = lower(trim(COALESCE(p_invite_code, '')))
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That room link is not valid.';
  END IF;
  IF v_room.status <> 'playing' OR v_room.current_player_id IS DISTINCT FROM p_player_id THEN
    RAISE EXCEPTION 'It is not your turn.';
  END IF;
  IF v_room.current_kind IS NOT NULL THEN
    RAISE EXCEPTION 'You already picked for this turn.';
  END IF;
  SELECT prompt INTO v_prompt FROM public.game_prompts
  WHERE active = true AND kind = p_kind
  ORDER BY random()
  LIMIT 1;
  IF v_prompt IS NULL THEN
    RAISE EXCEPTION 'There are no % prompts yet. Ask the admin to add some.', p_kind;
  END IF;
  UPDATE public.game_rooms
  SET current_kind = p_kind, current_prompt = v_prompt
  WHERE id = v_room.id;
  RETURN public.get_game_room(v_room.invite_code);
END;
$$;

-- The player whose turn it is can pass play to the next person without the host.
CREATE OR REPLACE FUNCTION public.finish_game_turn(p_invite_code text, p_player_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.game_rooms%ROWTYPE;
BEGIN
  SELECT * INTO v_room FROM public.game_rooms
  WHERE invite_code = lower(trim(COALESCE(p_invite_code, '')))
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That room link is not valid.';
  END IF;
  IF v_room.status <> 'playing' OR v_room.current_player_id IS DISTINCT FROM p_player_id THEN
    RAISE EXCEPTION 'Only the player whose turn it is can finish it.';
  END IF;
  PERFORM public.deal_next_turn(v_room.id);
  RETURN public.get_game_room(v_room.invite_code);
END;
$$;

-- 3) ROOM CHAT ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.game_players(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.game_messages TO service_role;
ALTER TABLE public.game_messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS game_messages_room_created_idx
  ON public.game_messages (room_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.send_game_message(p_invite_code text, p_player_id uuid, p_body text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id uuid;
BEGIN
  IF char_length(trim(COALESCE(p_body, ''))) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'Messages must be between 1 and 300 characters.';
  END IF;
  SELECT r.id INTO v_room_id
  FROM public.game_rooms r
  JOIN public.game_players p ON p.room_id = r.id
  WHERE r.invite_code = lower(trim(COALESCE(p_invite_code, ''))) AND p.id = p_player_id;
  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Join the room before chatting.';
  END IF;
  IF (SELECT count(*) FROM public.game_messages
      WHERE player_id = p_player_id AND created_at > now() - interval '10 seconds') >= 5 THEN
    RAISE EXCEPTION 'Slow down a little.';
  END IF;
  INSERT INTO public.game_messages (room_id, player_id, body)
  VALUES (v_room_id, p_player_id, trim(p_body));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_game_messages(p_invite_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id uuid;
  v_messages jsonb;
BEGIN
  SELECT id INTO v_room_id FROM public.game_rooms
  WHERE invite_code = lower(trim(COALESCE(p_invite_code, '')));
  IF v_room_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'player_id', m.player_id,
        'nickname', p.nickname,
        'body', m.body,
        'created_at', m.created_at
      ) ORDER BY m.created_at, m.id
    ),
    '[]'::jsonb
  ) INTO v_messages
  FROM (
    SELECT * FROM public.game_messages
    WHERE room_id = v_room_id
    ORDER BY created_at DESC, id DESC
    LIMIT 80
  ) m
  JOIN public.game_players p ON p.id = m.player_id;
  RETURN v_messages;
END;
$$;

REVOKE ALL ON FUNCTION public.choose_game_prompt(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_game_turn(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_game_message(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_game_messages(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.choose_game_prompt(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_game_turn(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_game_message(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_game_messages(text) TO anon, authenticated;
