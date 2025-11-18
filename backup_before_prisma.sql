--
-- PostgreSQL database dump
--

\restrict ax6RJbozh41xg8czMSHlQeFBETLoTQC6Khhnz6b9u6J18e5SHVUrVNjSVdWiDhR

-- Dumped from database version 16.10 (Ubuntu 16.10-1.pgdg22.04+1)
-- Dumped by pg_dump version 16.10 (Ubuntu 16.10-1.pgdg22.04+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: difficultylevel; Type: TYPE; Schema: public; Owner: wordwise_user
--

CREATE TYPE public.difficultylevel AS ENUM (
    'BEGINNER',
    'ELEMENTARY',
    'INTERMEDIATE',
    'UPPER_INTERMEDIATE',
    'ADVANCED',
    'PROFICIENT'
);


ALTER TYPE public.difficultylevel OWNER TO wordwise_user;

--
-- Name: listtype; Type: TYPE; Schema: public; Owner: wordwise_user
--

CREATE TYPE public.listtype AS ENUM (
    'LEARN_LATER',
    'FAVORITES',
    'MASTERED'
);


ALTER TYPE public.listtype OWNER TO wordwise_user;

--
-- Name: oauthprovider; Type: TYPE; Schema: public; Owner: wordwise_user
--

CREATE TYPE public.oauthprovider AS ENUM (
    'email',
    'google',
    'facebook'
);


ALTER TYPE public.oauthprovider OWNER TO wordwise_user;

--
-- Name: proficiencylevel; Type: TYPE; Schema: public; Owner: wordwise_user
--

CREATE TYPE public.proficiencylevel AS ENUM (
    'A1',
    'A2',
    'B1',
    'B2',
    'C1',
    'C2'
);


ALTER TYPE public.proficiencylevel OWNER TO wordwise_user;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alembic_version; Type: TABLE; Schema: public; Owner: wordwise_user
--

CREATE TABLE public.alembic_version (
    version_num character varying(32) NOT NULL
);


ALTER TABLE public.alembic_version OWNER TO wordwise_user;

--
-- Name: movies; Type: TABLE; Schema: public; Owner: wordwise_user
--

CREATE TABLE public.movies (
    id integer NOT NULL,
    title character varying NOT NULL,
    year integer NOT NULL,
    genre character varying,
    difficulty_level public.difficultylevel,
    script_text text,
    word_count integer,
    description text,
    poster_url character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone
);


ALTER TABLE public.movies OWNER TO wordwise_user;

--
-- Name: movies_id_seq; Type: SEQUENCE; Schema: public; Owner: wordwise_user
--

CREATE SEQUENCE public.movies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.movies_id_seq OWNER TO wordwise_user;

--
-- Name: movies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: wordwise_user
--

ALTER SEQUENCE public.movies_id_seq OWNED BY public.movies.id;


--
-- Name: user_word_lists; Type: TABLE; Schema: public; Owner: wordwise_user
--

CREATE TABLE public.user_word_lists (
    id integer NOT NULL,
    user_id integer NOT NULL,
    word_id integer NOT NULL,
    list_type public.listtype NOT NULL,
    added_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.user_word_lists OWNER TO wordwise_user;

--
-- Name: TABLE user_word_lists; Type: COMMENT; Schema: public; Owner: wordwise_user
--

COMMENT ON TABLE public.user_word_lists IS 'Junction table for user word lists';


--
-- Name: user_word_lists_id_seq; Type: SEQUENCE; Schema: public; Owner: wordwise_user
--

CREATE SEQUENCE public.user_word_lists_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_word_lists_id_seq OWNER TO wordwise_user;

--
-- Name: user_word_lists_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: wordwise_user
--

ALTER SEQUENCE public.user_word_lists_id_seq OWNED BY public.user_word_lists.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: wordwise_user
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying NOT NULL,
    username character varying NOT NULL,
    password_hash character varying,
    language_preference character varying,
    proficiency_level public.proficiencylevel,
    is_active boolean,
    is_admin boolean,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone,
    oauth_provider public.oauthprovider NOT NULL,
    google_id character varying,
    profile_picture_url character varying
);


ALTER TABLE public.users OWNER TO wordwise_user;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: wordwise_user
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO wordwise_user;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: wordwise_user
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: words; Type: TABLE; Schema: public; Owner: wordwise_user
--

CREATE TABLE public.words (
    id integer NOT NULL,
    word character varying NOT NULL,
    definition text,
    difficulty_level public.difficultylevel,
    frequency double precision,
    part_of_speech character varying,
    example_sentence text,
    translation character varying,
    movie_id integer
);


ALTER TABLE public.words OWNER TO wordwise_user;

--
-- Name: words_id_seq; Type: SEQUENCE; Schema: public; Owner: wordwise_user
--

CREATE SEQUENCE public.words_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.words_id_seq OWNER TO wordwise_user;

--
-- Name: words_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: wordwise_user
--

ALTER SEQUENCE public.words_id_seq OWNED BY public.words.id;


--
-- Name: movies id; Type: DEFAULT; Schema: public; Owner: wordwise_user
--

ALTER TABLE ONLY public.movies ALTER COLUMN id SET DEFAULT nextval('public.movies_id_seq'::regclass);


--
-- Name: user_word_lists id; Type: DEFAULT; Schema: public; Owner: wordwise_user
--

ALTER TABLE ONLY public.user_word_lists ALTER COLUMN id SET DEFAULT nextval('public.user_word_lists_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: wordwise_user
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: words id; Type: DEFAULT; Schema: public; Owner: wordwise_user
--

ALTER TABLE ONLY public.words ALTER COLUMN id SET DEFAULT nextval('public.words_id_seq'::regclass);


--
-- Data for Name: alembic_version; Type: TABLE DATA; Schema: public; Owner: wordwise_user
--

COPY public.alembic_version (version_num) FROM stdin;
81af206d3823
\.


--
-- Data for Name: movies; Type: TABLE DATA; Schema: public; Owner: wordwise_user
--

COPY public.movies (id, title, year, genre, difficulty_level, script_text, word_count, description, poster_url, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: user_word_lists; Type: TABLE DATA; Schema: public; Owner: wordwise_user
--

COPY public.user_word_lists (id, user_id, word_id, list_type, added_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: wordwise_user
--

COPY public.users (id, email, username, password_hash, language_preference, proficiency_level, is_active, is_admin, created_at, updated_at, oauth_provider, google_id, profile_picture_url) FROM stdin;
1	tamerlan.m.2000@gmail.com	tamerlan_m_2000	\N	en	A1	t	f	2025-11-16 11:50:19.379991-05	\N	google	111643628065782445007	https://lh3.googleusercontent.com/a/ACg8ocJNj2Yk6pjA1YPFipQdkfgpcOE6skoNU_WGaxLDpo6ueVtxF73C=s96-c
\.


--
-- Data for Name: words; Type: TABLE DATA; Schema: public; Owner: wordwise_user
--

COPY public.words (id, word, definition, difficulty_level, frequency, part_of_speech, example_sentence, translation, movie_id) FROM stdin;
\.


--
-- Name: movies_id_seq; Type: SEQUENCE SET; Schema: public; Owner: wordwise_user
--

SELECT pg_catalog.setval('public.movies_id_seq', 1, false);


--
-- Name: user_word_lists_id_seq; Type: SEQUENCE SET; Schema: public; Owner: wordwise_user
--

SELECT pg_catalog.setval('public.user_word_lists_id_seq', 1, false);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: wordwise_user
--

SELECT pg_catalog.setval('public.users_id_seq', 1, true);


--
-- Name: words_id_seq; Type: SEQUENCE SET; Schema: public; Owner: wordwise_user
--

SELECT pg_catalog.setval('public.words_id_seq', 1, false);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: public; Owner: wordwise_user
--

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: movies movies_pkey; Type: CONSTRAINT; Schema: public; Owner: wordwise_user
--

ALTER TABLE ONLY public.movies
    ADD CONSTRAINT movies_pkey PRIMARY KEY (id);


--
-- Name: user_word_lists user_word_lists_pkey; Type: CONSTRAINT; Schema: public; Owner: wordwise_user
--

ALTER TABLE ONLY public.user_word_lists
    ADD CONSTRAINT user_word_lists_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: wordwise_user
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: words words_pkey; Type: CONSTRAINT; Schema: public; Owner: wordwise_user
--

ALTER TABLE ONLY public.words
    ADD CONSTRAINT words_pkey PRIMARY KEY (id);


--
-- Name: ix_movies_id; Type: INDEX; Schema: public; Owner: wordwise_user
--

CREATE INDEX ix_movies_id ON public.movies USING btree (id);


--
-- Name: ix_movies_title; Type: INDEX; Schema: public; Owner: wordwise_user
--

CREATE INDEX ix_movies_title ON public.movies USING btree (title);


--
-- Name: ix_user_word_lists_id; Type: INDEX; Schema: public; Owner: wordwise_user
--

CREATE INDEX ix_user_word_lists_id ON public.user_word_lists USING btree (id);


--
-- Name: ix_users_email; Type: INDEX; Schema: public; Owner: wordwise_user
--

CREATE UNIQUE INDEX ix_users_email ON public.users USING btree (email);


--
-- Name: ix_users_google_id; Type: INDEX; Schema: public; Owner: wordwise_user
--

CREATE UNIQUE INDEX ix_users_google_id ON public.users USING btree (google_id);


--
-- Name: ix_users_id; Type: INDEX; Schema: public; Owner: wordwise_user
--

CREATE INDEX ix_users_id ON public.users USING btree (id);


--
-- Name: ix_users_username; Type: INDEX; Schema: public; Owner: wordwise_user
--

CREATE UNIQUE INDEX ix_users_username ON public.users USING btree (username);


--
-- Name: ix_words_id; Type: INDEX; Schema: public; Owner: wordwise_user
--

CREATE INDEX ix_words_id ON public.words USING btree (id);


--
-- Name: ix_words_word; Type: INDEX; Schema: public; Owner: wordwise_user
--

CREATE INDEX ix_words_word ON public.words USING btree (word);


--
-- Name: user_word_lists user_word_lists_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wordwise_user
--

ALTER TABLE ONLY public.user_word_lists
    ADD CONSTRAINT user_word_lists_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: user_word_lists user_word_lists_word_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wordwise_user
--

ALTER TABLE ONLY public.user_word_lists
    ADD CONSTRAINT user_word_lists_word_id_fkey FOREIGN KEY (word_id) REFERENCES public.words(id);


--
-- Name: words words_movie_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wordwise_user
--

ALTER TABLE ONLY public.words
    ADD CONSTRAINT words_movie_id_fkey FOREIGN KEY (movie_id) REFERENCES public.movies(id);


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT ALL ON SCHEMA public TO wordwise_user;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: tamerlan
--

ALTER DEFAULT PRIVILEGES FOR ROLE tamerlan IN SCHEMA public GRANT ALL ON SEQUENCES TO wordwise_user;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: tamerlan
--

ALTER DEFAULT PRIVILEGES FOR ROLE tamerlan IN SCHEMA public GRANT ALL ON TABLES TO wordwise_user;


--
-- PostgreSQL database dump complete
--

\unrestrict ax6RJbozh41xg8czMSHlQeFBETLoTQC6Khhnz6b9u6J18e5SHVUrVNjSVdWiDhR

