# Authentication

The login route checks session expiration and calls a signature helper.
The fixture's signature helper checks only a string prefix; it is not a secure
cryptographic implementation and should not be used as production authentication.
