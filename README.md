Forked from https:www.npmjs.com/package/rtf2html

[rtf.js]******************************[http:code.google.com/p/obremsdk/]*

 JavaScript: Rich Text Format (RTF) Processing
 Version 0.12

 RTF is a lot like HTML, text that has mark-up which is also text.  Instead
 of tags, it uses the concept of control words.  Rather than nested tags,
 it has blocks enclosed in braces.

 This module has been designed with three layers of functionality which
 turns out to correspond with what the RTF Specification 1.3 said of RTF
 Readers:

      1. Low-Level / Tokenizing: At the lowest level is the concept of breaking
      an RTF string into tokens, stored as 32-bit integers.  Functions are
      provided to get higher-level data using the token, original string, and
      index where the token was found.

      2. Parsing: Next is the RtfParser object which generically traverses the
      RTF control words and blocks.  A map of destination handlers is maintained
      for acting on the information in a more meaningful way.

      3. Handlers: The destination handlers here will put data into a high-
      level 'doc' object as well as convert to HTML.

-[RTF Tokens]---------------------------------------------------------------

 Tokens are represented as 32-bit integers.  Most information can be extra-
 cted from this number, but missing is the position of the token in the
 source string and a reference to that string itself.  Thus those three
 parameters are necessary for some functions, but many others require only
 the token itself.  A lot of the functions don't even bother calling
 functions, but rather calculate the values themselves.

 A token is made up of multiple numeric parts which are packed tightly to-
 gether using bit-level operations (shifting, masking, etc.).  These bits
 have the following separation from left (most-significant) to right
 (least-significant):

  31                 15     11     8          0 <-- shift position
 [1] [0000000000000000] [1111] [000] [11111111]
 has val:16             skp:4  typ:3 len:8

 As a C/C++ struct, this would look like so:

      struct t_rtf_token
      {
              unsigned char len;
              unsigned typ : 3;
              unsigned skp : 4;
              unsigned val : 16;
              unsigned has : 1;
      };

 These parts are defined as follows:

      len: Length of the entire token.  Data tokens can only be 255 characters
      because this is limited to 8 bits.  Zero-length tokens are possible for
      higher-level purposes, but are never returned from GetRtfTk().

      typ: Type of the token which determines how GetRtfTxt() and GetRtfVal()
      will react:

              0x0: Lexically incorrect data; generally ignored.
              0x1: Data.
              0x2: Start new destination ({).
              0x3: End current destination (}).
              0x4: Ignorable destination marker (\*).
              0x5: Symbol.
              0x6: Control word.
              0x7: Character (value == character value).

      skp: Amount of characters to skip to get to the end of a control word,
      usually to the start of its numeric value.  Add 2 to the bit value, thus
      the possible values are 2 to 17.

      val: Numeric value + 32,768 (subtract that number to get actual, signed
      value).  This isn't stored at the last 16 bits, because if it was the last
      bit MAY be interpreted as the sign (yes for JScript on Win32, no for
      JScript on Win64).  This could be detected, but at the cost of processing
      power.

      has: HAS a numeric value, otherwise GetRtfVal() will return NaN.

-[History]------------------------------------------------------------------
 2007-09-24 by NeilO .... v0.12: Made part of ObremSDK.
 2007-01-28 by NeilO .... Created.

 (C)opyright 2007++ by Neil C. Obremski;                     New BSD License
***********************[http:www.opensource.org/licenses/bsd-license.php]*

----------------------------------------------------------------------------
----------------------------------------------------------------------------
 Low-Level RTF Functions

 * NewRtfTk()
 * GetRtfTk()
 * RtfTkLen()
 * RtfTkTxt()
 * RtfTkChr()
 * RtfTkCtl()
 * RtfTkVal()
 * RtfSkipB()
 * RtfConst()
 * RtfPkgOb()

----------------------------------------------------------------------------
----------------------------------------------------------------------------

_[NewRtfTk()]_______________________________________________________________

 Creates a new token and returns the result.  Throws an exception on
 failure.  This function isn't used so much as it exists to illustrate how
 tokens are represented.

 See "RTF Tokens" in header comment for more details.

 typ .................... [ in] Type; 0=invalid, 1=data, 2=push, 3=pop,
                                                      4=ignorable, 5=symbol, 6=control, 7=character.
 len .................... [ in] Length; valid values are 0 to 255.  This is
                                                      fixed for types 2, 3, and 4.
 val .................... [ in] Value; 16-bit signed integer with valid
                                                      range of -32,768 to 32,767.  If this is null (or
                                                      undefined) then no value is set and the 'has' bit
                                                      is set to 0 instead of 1.
 skp .................... [ in] Skip this number of characters to get to the
                                                      end of the control word portion (usually to get to
                                                      the value); valid range is 2 (default) to 17.

