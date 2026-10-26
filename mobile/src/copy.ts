// Every word the app shows, in one place (the voice and vocabulary: CLAUDE.md, "Copy and tone").
// Grouped by screen or feature; a function where the text takes a value. No i18n library yet: a
// French or Arabic version would be another object of the same shape (`Copy`), picked at start.
//
// Vocabulary: a Track Vote event is a "room" here (the code and the API still say event, ADR-038).
// Who can see: "Public" / "Private". Who can act: "Everyone..." / "Invited people only". The vote
// queue is "Up next" / "the queue"; the shared list is the "playlist".

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const copy = {
  common: {
    tryAgain: "Try again",
    back: "Back",
    close: "Close",
    showMore: "Show more",
    invitePeople: "Invite people",
    public: "Public",
    private: "Private",
    privateSuffix: " · Private",
    yours: "Yours",
    emailLabel: "Email",
    emailPlaceholder: "name@example.com",
    codeLabel: "Code",
    codePlaceholder: "123456",
    or: "or",
    notFoundPage: "This page doesn't exist.",
    findPeople: "Find people",
    findPeoplePlaceholder: "Name (3 letters or more)",
    noPeopleMatch: (query: string) => `No one has a name starting with “${query}”.`,
  },

  /** Failures that any screen can hit. Plain and specific: what went wrong, what to do. */
  errors: {
    network: "No connection. Check your internet and the server address, then try again.",
    server: "Something broke on our side. Try again in a moment.",
    rateLimited: "Too many tries. Wait a few minutes, then try again.",
    unknown: "That didn't work. Try again.",
    catalogMissing: "This track isn't in the catalog anymore.",
    catalogDown: "Can't reach the music catalog right now. Try again in a moment.",
  },

  tabs: {
    rooms: "Rooms",
    playlists: "Playlists",
    profile: "Profile",
  },

  live: {
    live: "Live",
    offline: "Not live",
    connecting: "Connecting",
  },

  welcome: {
    headline: "Your room. Your music. Everyone's call.",
    intro: "Vote on what plays next and build playlists together, live.",
    createAccount: "Create account",
    signIn: "Sign in",
    serverAddress: "Server address",
  },

  auth: {
    signIn: {
      title: "Welcome back",
      subtitle: "Sign in to vote, suggest tracks and edit playlists.",
      passwordLabel: "Password",
      submit: "Sign in",
      forgotPassword: "Forgot your password?",
      createAccount: "Create account",
    },
    signUp: {
      title: "Make it yours",
      subtitle: "We'll email you a 6-digit code to check it's you.",
      passwordLabel: "Password",
      submit: "Create account",
      haveAccount: "I already have an account",
    },
    verifyEmail: {
      title: "Check your email",
      subtitleAskEmail: "Enter your email and the 6-digit code we sent to it.",
      subtitleSent: (email: string) =>
        `We sent a 6-digit code to ${email}. It expires in 10 minutes.`,
      submit: "Confirm email",
      resent: "If this email still needs confirming, a new code is on its way.",
      confirmed: "Email confirmed. Now sign in.",
    },
    forgotPassword: {
      title: "Locked out? Happens.",
      subtitle:
        "Enter the email you signed up with. If it has an account, we'll send it a 6-digit code.",
      sendCode: "Send code",
      resetTitle: "Choose a new password",
      resetSubtitle: (email: string) =>
        `If ${email} has an account, we sent it a 6-digit code. Enter it with your new password.`,
      newPasswordLabel: "New password",
      submit: "Change password",
      changed: "Password changed. Sign in with the new one.",
    },
    /** Shared by the screens that send a code (verify email, reset password). */
    code: {
      resend: "Send a new code",
      resendIn: (seconds: number) => `Send a new code in ${seconds} s`,
      differentEmail: "Use a different email",
    },
    social: {
      continueWith: (provider: string) => `Continue with ${provider}`,
      notSetUp: (provider: string) =>
        `${provider} sign-in isn't set up in this version of the app. Use your email instead.`,
      failed: (provider: string) => `${provider} sign-in didn't work. Try again.`,
      notConfirmed: (provider: string) =>
        `${provider} didn't confirm your account. Try again.`,
      unavailable: (provider: string) =>
        `${provider} sign-in isn't available right now. Try again later, or use your email.`,
      // No automatic linking by email (ADR-007): the owner signs in, then links the provider.
      emailTaken: (provider: string) =>
        `This email already has an account. Sign in with your password, then link ${provider} in Settings.`,
    },
    errors: {
      wrongCredentials: "Email or password is wrong. Check them and try again.",
      notVerified:
        "Confirm your email first: enter the code we sent, or ask for a new one.",
      emailTaken: "This email already has an account. Sign in instead.",
      wrongCode: "That code is wrong or expired. Ask for a new one.",
      checkFields: "Check the highlighted fields.",
    },
    /** The form checks, the same rules as the backend (auth/forms/validation.ts). */
    validation: {
      passwordPolicy:
        "At least 8 characters, with a lowercase and an uppercase letter, a digit and a symbol.",
      choosePassword: "Choose a password.",
      passwordTooShort: "Use at least 8 characters.",
      passwordTooLong:
        "That password is too long: 72 bytes max (accented letters and emoji count double or more).",
      passwordMissing: (rules: string) => `Add ${rules}.`,
      passwordRules: {
        lowercase: "a lowercase letter",
        uppercase: "an uppercase letter",
        digit: "a digit",
        symbol: "a symbol",
      },
      and: "and",
      enterPassword: "Enter your password.",
      enterEmail: "Enter your email.",
      emailTooLong: "That email is too long.",
      emailShape: "Enter a valid email, like name@example.com.",
      enterCode: "Enter the 6-digit code.",
      codeShape: "The code is 6 digits.",
    },
  },

  rooms: {
    title: "Rooms",
    create: "Create room",
    empty: "It's quiet out here. Start a room and get things going.",
    open: (name: string) => `Open ${name}`,
    voteRule: {
      everyone: "Everyone in the room can vote",
      invited_only: "Only invited people can vote",
      location_time: "Votes at the venue, while it's on",
    },
    locationRule: (radiusMeters: number, from: string, to: string) =>
      `Votes count within ${radiusMeters} m of the venue, from ${from} to ${to}.`,
  },

  createRoom: {
    title: "Create room",
    nameLabel: "Name",
    namePlaceholder: "Friday night",
    visibilityLabel: "Who can see it",
    visibilityHelp: {
      public: "Anyone can find it.",
      private: "Only you and the people you invite can find it.",
    },
    voteLabel: "Who can vote",
    voteChoices: {
      everyone: "Everyone in the room",
      invited_only: "Invited people only",
      location_time: "At the venue",
    },
    voteHelp: {
      everyone: "Anyone who can see the room can vote and suggest tracks.",
      invited_only: "Anyone who can see it can follow along. Only invited people vote.",
      location_time:
        "People vote only near the venue, while the room is on. You own it, so you can always vote.",
    },
    useMyPosition: "Use my current position",
    latitudeLabel: "Venue latitude",
    longitudeLabel: "Venue longitude",
    radiusLabel: "Votes count within",
    radius: (meters: number) => `${meters} m`,
    opensLabel: "Voting opens",
    opensNow: "Now",
    opensIn: (hours: number) => `In ${hours} h`,
    lastsLabel: "Voting lasts",
    lasts: (hours: number) => `${hours} h`,
    submit: "Create room",
    errors: {
      nameMissing: "Give the room a name.",
      nameTooLong: (max: number) => `Keep the name under ${max + 1} characters.`,
      latitude: "Enter a latitude between -90 and 90, or use your position.",
      longitude: "Enter a longitude between -180 and 180, or use your position.",
    },
  },

  trackVote: {
    accessLost:
      "You can't see this room anymore: it was deleted, made private, or you were removed.",
    backToRooms: "Back to rooms",
    ownerRuleNote: " You own this room, so the rule doesn't apply to you.",
    nothingPlaying: "Nothing's playing.",
    startPlaying: "Start playing",
    nextTrack: "Next track",
    suggest: "Suggest a track",
    suggestAction: "Add",
    followOnly: "You can follow this room, but you can't vote in it.",
    upNext: "Up next",
    emptyQueue: "Nothing queued. Suggest the first track.",
    emptyQueueFollowOnly: "Nothing queued yet.",
    errors: {
      notFound: "This room is gone, or you can't see it anymore.",
      notInvited: "Voting is limited in this room. Only invited people can vote.",
      // The server says this after a position was sent: it was not precise enough (worse than 100 m).
      imprecisePosition:
        "Your position isn't precise enough to vote here. Turn on precise location, then try again.",
      outsideArea: "You're too far from the venue to vote.",
      outsideTime: "Voting is closed: this room isn't on right now.",
      notVotable: "This track is playing or has already played.",
      queueChanged: "The queue changed on another device first. Here's the latest.",
      ownerOnly: "Only the room's owner can do that.",
    },
    alreadyQueued: "That track was already in the queue, so your vote went to it.",
  },

  /** Why the phone gave no position, for a vote in a room that votes at its venue. */
  location: {
    services_off:
      "Turn on location services to vote here: this room takes votes at its venue.",
    denied:
      "This room takes votes at its venue. Allow Music Room to use your location to vote.",
    blocked: "Location is off for Music Room. Turn it on in Settings to vote here.",
    timeout: "Couldn't find your position. Try again.",
  },

  playlists: {
    title: "Playlists",
    create: "Create playlist",
    empty: "No playlists yet. Start one and add some tracks.",
    open: (name: string) => `Open ${name}`,
    editRule: {
      everyone: "Everyone can edit",
      invited_only: "Only invited people can edit",
    },
  },

  createPlaylist: {
    title: "Create playlist",
    nameLabel: "Name",
    namePlaceholder: "Road trip",
    visibilityLabel: "Who can see it",
    visibilityHelp: {
      public: "Anyone can find it.",
      private: "Only you and the people you invite can find it.",
    },
    editLabel: "Who can edit",
    editChoices: {
      everyone: "Everyone who can see it",
      invited_only: "Invited people only",
    },
    editHelp: {
      everyone: "Anyone who can see the playlist can add, move and remove tracks.",
      invited_only: "Anyone who can see it can listen along. Only invited people edit.",
    },
    submit: "Create playlist",
    errors: {
      nameMissing: "Give the playlist a name.",
      nameTooLong: (max: number) => `Keep the name under ${max + 1} characters.`,
    },
  },

  playlistEditor: {
    accessLost:
      "You can't see this playlist anymore: it was deleted, made private, or you were removed.",
    backToPlaylists: "Back to playlists",
    trackCount: (n: number) => ` · ${plural(n, "track", "tracks")}`,
    addTrack: "Add track",
    addAction: "Add",
    empty: "This playlist is empty. Add the first track.",
    emptyListenOnly: "This playlist is empty.",
    listenOnly: "You can listen along, but you can't edit this playlist.",
    errors: {
      notFound: "This playlist is gone, or you can't see it anymore.",
      notInvited: "Editing is limited in this playlist. Only invited people can edit.",
      // Someone else moved or removed the track it was placed after: the list is read again.
      anchorGone:
        "The playlist changed in the meantime. Here's the latest, try once more.",
      entryGone: "Someone else just removed that track.",
      full: "This playlist is full (500 tracks max).",
      ownerOnly: "Only the playlist's owner can do that.",
    },
  },

  tracks: {
    votes: (n: number) => plural(n, "vote", "votes"),
    playing: "Playing",
    vote: "Vote",
    voted: "Voted",
    voteFor: (title: string) => `Vote for ${title}`,
    removeVote: (title: string) => `Remove your vote for ${title}`,
    moveUp: (title: string) => `Move ${title} up`,
    moveDown: (title: string) => `Move ${title} down`,
    remove: (title: string) => `Remove ${title}`,
    action: (action: string, title: string) => `${action} ${title}`,
  },

  search: {
    label: "Search the catalog",
    placeholder: "Artist or title",
    tooShort: "Type at least 2 characters.",
    noResults: (query: string) => `No tracks found for “${query}”.`,
  },

  invitations: {
    title: "Invite people",
    invited: "Invited",
    invite: "Invite",
    inviteName: (name: string) => `Invite ${name}`,
    invitedCount: (n: number) => `Invited (${n})`,
    empty: "Nobody invited yet. Find people above.",
    remove: "Remove",
    removeName: (name: string) => `Remove ${name}'s invitation`,
    errors: {
      ownerOnly: "Only the owner can manage invitations.",
      gone: "This is gone, or you can't see it anymore.",
      personGone: "This person's account doesn't exist anymore.",
      cannotInvite:
        "You can't invite this person (for example, yourself: as the owner you always have access).",
    },
  },

  profile: {
    friends: "Friends",
    /** The Friends row with requests waiting; `count` is "3" or "20+". */
    friendsWaiting: (count: string) =>
      `Friends, ${count} ${count === "1" ? "request" : "requests"} waiting`,
    settings: "Settings",
    signOut: "Sign out",
    signOutFailed: "Couldn't sign out. Try again.",
    notSignedIn: "Not signed in.",
    notSet: "Not set",
    noGenres: "No genres yet",
    /** The profile's sections, named after what they hold: in your words on your own profile. */
    headings: {
      mine: { bio: "My bio", about: "About me", music: "My taste in music" },
      theirs: { bio: "Bio", about: "About", music: "Music taste" },
    },
    /** Edit profile's groups, one per block: `audience` says exactly who the server shows it to (ADR-024). */
    blocks: {
      public: { title: "Public", audience: "Anyone signed in can see this." },
      friends: {
        title: "Friends only",
        audience: "Only you and your friends can see this.",
      },
      music: {
        title: "Music taste",
        audience: "Only you and your friends can see this.",
      },
      private: { title: "Private", audience: "Only you can see this." },
    },
    fields: {
      bio: "Bio",
      fullName: "Full name",
      city: "City",
      genres: "Genres",
      phone: "Phone",
      birthDate: "Birth date",
    },
    loadFailed: "Couldn't load your profile.",
  },

  /** The username (the API's displayName, ADR-046): unique, how people find you. */
  username: {
    label: "Username",
    pickTitle: "Pick your username",
    pickSubtitle: "It's how friends find you. You can change it later in Settings.",
    changeTitle: "Change username",
    helper: "3 to 20 letters, numbers, . or _, starting with a letter.",
    save: "Save username",
    saved: "Username saved.",
    change: "Change",
    changeName: "Change your username",
    errors: {
      empty: "Pick a username.",
      characters: "Use only letters, numbers, . and _.",
      firstLetter: "Start with a letter.",
      length: (min: number, max: number) => `Use ${min} to ${max} characters.`,
      reserved: "Usernames can't start with user_.",
      taken: "That username is taken. Try another one.",
      rejected: "The server didn't accept that username. Try another one.",
    },
  },

  friends: {
    title: "Friends",
    requests: "Requests",
    sent: "Sent",
    yourFriends: "Your friends",
    noFriends: "No friends yet. Find your people above.",
    open: (name: string) => `Open ${name}'s profile`,
    addFriend: "Add friend",
    cancelRequest: "Cancel request",
    cancelRequestTo: (name: string) => `Cancel your request to ${name}`,
    accept: "Accept",
    acceptFrom: (name: string) => `Accept ${name}'s request`,
    decline: "Decline",
    declineFrom: (name: string) => `Decline ${name}'s request`,
    nowFriends: "You're friends now.",
    unfriend: "Unfriend",
    unfriendConfirm: (name: string) =>
      `Unfriend ${name}? You'll both stop seeing each other's About and music taste.`,
    keepFriend: "Keep as friend",
    notFound: "This person doesn't exist, or their account is gone.",
    errors: {
      alreadyAsked: "You've already asked them.",
      alreadyFriends: "You're already friends.",
      requestGone: "That request isn't there anymore.",
      personGone: "This person's account doesn't exist anymore.",
      onlyTheyCanAccept: "Only the person you asked can accept.",
      notYourself: "You can't add yourself as a friend.",
    },
  },

  editProfile: {
    title: "Edit profile",
    /** One per section of the profile: the edit button's label and the screen it opens. */
    titles: { bio: "Edit bio", about: "Edit your info", music: "Edit music taste" },
    bioPlaceholder: "A line about you and your music",
    fullNamePlaceholder: "Ada Lovelace",
    cityPlaceholder: "Paris",
    genresPlaceholder: "techno, jazz, r&b",
    genresHelper: "Separate them with commas. Up to 10.",
    phonePlaceholder: "+33 6 12 34 56 78",
    birthDatePlaceholder: "YYYY-MM-DD",
    save: "Save changes",
    errors: {
      tooLong: (max: number) => `Keep it to ${max} characters max.`,
      phone: "Enter a phone number: digits, spaces and + ( ) . - only.",
      birthDateShape: "Enter a real date as YYYY-MM-DD, like 2001-09-14.",
      birthDateTooOld: "Enter a year from 1900 on.",
      birthDateFuture: "Your birth date can't be in the future.",
      tooManyGenres: (max: number) => `Keep it to ${max} genres max.`,
      genreTooLong: (max: number) => `Keep each genre to ${max} characters max.`,
      genreShape: "Start each genre with a letter or digit, and skip special characters.",
      rejected: "The server didn't accept one of the fields. Check them and try again.",
    },
  },

  settings: {
    title: "Settings",
    /** Sign-in methods: link and unlink Google or Facebook (ADR-025, ADR-044). */
    signIn: {
      title: "Sign-in methods",
      password: "Email and password",
      noPassword: "Not set up",
      linked: "Linked",
      notLinked: "Not linked",
      link: "Link",
      linkName: (provider: string) => `Link ${provider}`,
      unlink: "Unlink",
      unlinkName: (provider: string) => `Unlink ${provider}`,
      onlyWay: "Your only way to sign in",
      notInThisApp: "Not available in this version of the app",
      confirmLink: (provider: string) =>
        `Confirm it's you to link ${provider}. Then pick the ${provider} account to link.`,
      confirmUnlink: (provider: string) =>
        `Confirm it's you to unlink ${provider}. You won't be able to sign in with it anymore.`,
      passwordLabel: "Your password",
      confirmWithPassword: "Confirm with password",
      confirmWith: (provider: string) => `Confirm with ${provider}`,
      cancel: "Cancel",
      cantConfirm: "There's no way to confirm it's you in this version of the app.",
      linkedDone: (provider: string) =>
        `${provider} linked. You can sign in with it now.`,
      unlinkedDone: (provider: string) => `${provider} unlinked.`,
      errors: {
        wrongPassword: "That password isn't right.",
        proofNotLinked: "That account isn't linked to you. Confirm with one that is.",
        alreadyLinked: (provider: string) =>
          `That ${provider} account is already linked to an account.`,
        lastMethod: "You can't remove your only way to sign in.",
        notLinked: (provider: string) => `${provider} isn't linked anymore.`,
        providerDown: (provider: string) =>
          `Can't reach ${provider} right now. Try again in a moment.`,
      },
    },
    serverAddressTitle: "Server address",
    addressLabel: "Server address",
    addressPlaceholder: "http://192.168.1.20:3000",
    addressHelp: "The computer running the Music Room backend, as http://address:port.",
    addressReadOnly: "Sign out to change it: your session belongs to this server.",
    check: "Check connection",
    save: "Save",
    useDefault: "Use the default",
    backToDefault: "Back to this build's default server.",
    invalid:
      "Enter an address that starts with http:// or https://, like http://192.168.1.20:3000.",
    reachable: "Connected: this is a Music Room server.",
    notMusicRoom: "Something answered at this address, but it isn't a Music Room server.",
    unreachable:
      "No answer from this address. Check it, and that this phone is on the same network.",
    saved: "Saved. The app now uses this server.",
    notSaved: "Couldn't change the address on this phone. Try again.",
  },
};

export type Copy = typeof copy;
