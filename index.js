//*[rtf.js]******************************[http://code.google.com/p/obremsdk/]*
//
// JavaScript: Rich Text Format (RTF) Processing
// Version 0.12
//
// RTF is a lot like HTML, text that has mark-up which is also text.  Instead
// of tags, it uses the concept of control words.  Rather than nested tags,
// it has blocks enclosed in braces.
//
// This module has been designed with three layers of functionality which
// turns out to correspond with what the RTF Specification 1.3 said of RTF
// Readers:
//
//      1. Low-Level / Tokenizing: At the lowest level is the concept of breaking
//      an RTF string into tokens, stored as 32-bit integers.  Functions are
//      provided to get higher-level data using the token, original string, and
//      index where the token was found.
//
//      2. Parsing: Next is the RtfParser object which generically traverses the
//      RTF control words and blocks.  A map of destination handlers is maintained
//      for acting on the information in a more meaningful way.
//
//      3. Handlers: The destination handlers here will put data into a high-
//      level 'doc' object as well as convert to HTML.
//
//-[RTF Tokens]---------------------------------------------------------------
//
// Tokens are represented as 32-bit integers.  Most information can be extra-
// cted from this number, but missing is the position of the token in the
// source string and a reference to that string itself.  Thus those three
// parameters are necessary for some functions, but many others require only
// the token itself.  A lot of the functions don't even bother calling
// functions, but rather calculate the values themselves.
//
// A token is made up of multiple numeric parts which are packed tightly to-
// gether using bit-level operations (shifting, masking, etc.).  These bits
// have the following separation from left (most-significant) to right
// (least-significant):
//
//  31                 15     11     8          0 <-- shift position
// [1] [0000000000000000] [1111] [000] [11111111]
// has val:16             skp:4  typ:3 len:8
//
// As a C/C++ struct, this would look like so:
//
//      struct t_rtf_token
//      {
//              unsigned char len;
//              unsigned typ : 3;
//              unsigned skp : 4;
//              unsigned val : 16;
//              unsigned has : 1;
//      };
//
// These parts are defined as follows:
//
//      len: Length of the entire token.  Data tokens can only be 255 characters
//      because this is limited to 8 bits.  Zero-length tokens are possible for
//      higher-level purposes, but are never returned from GetRtfTk().
//
//      typ: Type of the token which determines how GetRtfTxt() and GetRtfVal()
//      will react:
//
//              0x0: Lexically incorrect data; generally ignored.
//              0x1: Data.
//              0x2: Start new destination ({).
//              0x3: End current destination (}).
//              0x4: Ignorable destination marker (\*).
//              0x5: Symbol.
//              0x6: Control word.
//              0x7: Character (value == character value).
//
//      skp: Amount of characters to skip to get to the end of a control word,
//      usually to the start of its numeric value.  Add 2 to the bit value, thus
//      the possible values are 2 to 17.
//
//      val: Numeric value + 32,768 (subtract that number to get actual, signed
//      value).  This isn't stored at the last 16 bits, because if it was the last
//      bit MAY be interpreted as the sign (yes for JScript on Win32, no for
//      JScript on Win64).  This could be detected, but at the cost of processing
//      power.
//
//      has: HAS a numeric value, otherwise GetRtfVal() will return NaN.
//
//-[History]------------------------------------------------------------------
// 2007-09-24 by NeilO .... v0.12: Made part of ObremSDK.
// 2007-01-28 by NeilO .... Created.
//
// (C)opyright 2007++ by Neil C. Obremski;                     New BSD License
//***********************[http://www.opensource.org/licenses/bsd-license.php]*

//----------------------------------------------------------------------------
//----------------------------------------------------------------------------
// Low-Level RTF Functions
//
// * NewRtfTk()
// * GetRtfTk()
// * RtfTkLen()
// * RtfTkTxt()
// * RtfTkChr()
// * RtfTkCtl()
// * RtfTkVal()
// * RtfSkipB()
// * RtfConst()
// * RtfPkgOb()
//
//----------------------------------------------------------------------------
//----------------------------------------------------------------------------

//_[NewRtfTk()]_______________________________________________________________
//
// Creates a new token and returns the result.  Throws an exception on
// failure.  This function isn't used so much as it exists to illustrate how
// tokens are represented.
//
// See "RTF Tokens" in header comment for more details.
//
// typ .................... [ in] Type; 0=invalid, 1=data, 2=push, 3=pop,
//                                                      4=ignorable, 5=symbol, 6=control, 7=character.
// len .................... [ in] Length; valid values are 0 to 255.  This is
//                                                      fixed for types 2, 3, and 4.
// val .................... [ in] Value; 16-bit signed integer with valid
//                                                      range of -32,768 to 32,767.  If this is null (or
//                                                      undefined) then no value is set and the 'has' bit
//                                                      is set to 0 instead of 1.
// skp .................... [ in] Skip this number of characters to get to the
//                                                      end of the control word portion (usually to get to
//                                                      the value); valid range is 2 (default) to 17.
//
function NewRtfTk(typ, len, val, skp)
{
        // - -
        // validate type
        //
        typ = parseInt(typ);
        if (isNaN(typ))
        {
                throw Error("NewRtfTk: Missing or invalid type");
        }

        // - -
        // validate length
        //
        len = parseInt(len);
        if (isNaN(len))
        {
                if (2 === typ || 3 === typ)
                        len = 1;
                else if (4 === typ)
                        len = 2;
                else
                        throw Error("NewRtfTk: Missing length (typ=" + typ + ")");
        }

        // - -
        // validate value
        //
        var has = 1;
        val = parseInt(val);
        if (isNaN(val))
        {
                has = 0;
                val = 0;
        }
        else if (val < -32768 || val > 32767)
        {
                throw Error("NewRtfTk: Value " + val +
                        " out of range (-32,768 to 32,767)");
        }

        // - -
        // validate skip
        //
        skp = parseInt(skp);
        if (isNaN(skp))
        {
                skp = 0;
        }
        else if (skp < 2 || skp > 17)
        {
                throw Error("NewRtfTk: Skip amount " + skp +
                        " out of range (2 to 17)");
        }
        else
        {
                // stored in 4 bits, it must be in 0 to 15 range
                skp -= 2;
        }

        // - -
        // form and return token as 32-bit integer
        //
        return (has << 31) | (val << 15) | (skp << 11) | (typ << 8) | len;

} // NewRtfTk()

//_[GetRtfTk()]_______________________________________________________________
//
// Parses the next token in a string and returns it.  Since tokens are never
// longer than 255 characters, this can be used on a partially-loaded RTF
// string.
//
// s ...................... [ in] RTF string.
// i ...................... [ in] Starting position.
//
function GetRtfTk(s, i)
{
        var c = s.charCodeAt(i);

        // { open brace
        if (123 === c)
        {
                // NewRtfTk(RtfConst().PUSH);
                return 513;
        }
        // } close brace
        else if (125 === c)
        {
                // NewRtfTk(RtfConst().POP);
                return 769; 
        }
        // \ back slash: control word / special character
        else if (92 === c)
        {
                var len = 1;
                for (c = s.charCodeAt(++i);
                        c >= 97 && c <= 122;
                        c = s.charCodeAt(++i))
                {
                        len++;
                }

                // only read one character, either it's special or invalid
                if (1 === len)
                {
                        // * asterisk == ignorable destination marker
                        if (42 === c)
                        {
                                // NewRtfTk(RtfConst().IGNORABLE);
                                return 1026;
                        }

                        // ' apostrophe == symbol with 2-digit hex value
                        if (39 === c)
                        {
                                // invalid (not enough characters left in string)
                                if (i + 2 > s.length)
                                        return (s.length - i) + 2;

                                var d1 = s.charCodeAt(++i);
                                var d2 = s.charCodeAt(++i);
                                
                                if (d1 >= 0x30 && d1 <= 0x39)           // 0-9
                                        d1 -= 0x30;
                                else if (d1 >= 0x41 && d1 <= 0x46)      // A-F
                                        d1 -= 0x37;
                                else if (d1 >= 0x61 && d1 <= 0x66)      // a-f
                                        d1 -= 0x57;
                                else
                                        return 4; // invalid hex (left digit)

                                if (d2 >= 0x30 && d2 <= 0x39)           // 0-9
                                        d2 -= 0x30;
                                else if (d2 >= 0x41 && d2 <= 0x46)      // A-F
                                        d2 -= 0x37;
                                else if (d2 >= 0x61 && d2 <= 0x66)      // a-f
                                        d2 -= 0x57;
                                else
                                        return 4; // invalid hex (right digit)

                                // NewRtfTk(RtfConst().CHARACTER, 4, (d1 << 4) | d2);
                                return (1 << 31) | (d1 << 19) | (d2 << 15) | 1796;
                        }

                        if
                        (
                                c != 92 &&      // \ backslash
                                c != 45 &&      // - dash
                                c != 58 &&      // : colon
                                c != 95 &&      // _ underscore
                                c < 123 && c > 126      // { | } ~
                        )
                        {
                                // NewRtfTk(RtfConst().INVALID, 2);
                                return 2;
                        }

                        // NewRtfTk(RtfConst().SYMBOL, 2, c);
                        return (1 << 31) | ((c+32768) << 15) | 1282;
                }

                // digits possibly preceded by a hyphen
                if (45 === c || (c >= 48 && c <= 57))
                {
                        var skp = len;
                        var vi = i;     // start index of value

                        for (c = s.charCodeAt(++i); i < s.length; c = s.charCodeAt(++i))
                        {
                                len++;
                                if (45 !== c && (c < 48 || c > 57))
                                {
                                        // space terminator (absorbed into control word token)
                                        if (32 === c)
                                                len++;
                                        break;
                                }
                        }

                        // slice is used, not substr, because an explicit index is passed
                        // rather than a length
                        var val = parseInt(s.slice(vi, i));

                        // add 32768 to make any value unsigned
                        val += 32768;
                        
                        // NewRtfTk(RtfConst().CONTROL, len, val, skp);
                        var tk = (1 << 31) | (val << 15) | ((skp-2) << 11) | 1536 | len;
                        return tk;
                }
                // space terminator (absorbed into control word token)
                else if (32 === c)
                {
                        len++;

                        // NewRtfTk(RtfConst().CONTROL, len, null, len - 1);
                        return ((len-3) << 11) | 1536 | len;
                }

                // NewRtfTk(RtfConst().CONTROL, len, null, len);
                return ((len-2) << 11) | 1536 | len;
        }
        // CRLF's (logged as symbol in case it's wanted)
        else if (10 === c || 13 === c)
        {
                var len = 1;
                for (c = s.charCodeAt(++i); i < s.length; c = s.charCodeAt(++i))
                {
                        if (10 !== c && 13 !== c)
                                break;
                        len++;
                        if (255 === len)
                                break;
                }

                // NewRtfTk(RtfConst().CONTROL, len, 13);
                return (1 << 31) | 1074169088 | len;
        }

        // data
        var len = 1;
        for (c = s.charCodeAt(++i); i < s.length; c = s.charCodeAt(++i))
        {
                if (92 === c || 123 === c || 125 === c || 13 === c || 10 === c)
                        break;
                len++;
                if (255 === len)
                        break;
        }

        // NewRtfTk(RtfConst().DATA, len);
        return (256 | len);

} // GetRtfTk()

//_[RtfTkTyp()]_______________________________________________________________
//
// Returns the type of the token.
//
// t ...................... [ in] Token; see "RTF Tokens".
//
function RtfTkTyp(t)
{
        return (t >> 8) & 0x7;
}

//_[RtfTkLen()]_______________________________________________________________
//
// Returns the length of the token from its starting position.
//
// t ...................... [ in] Token; see "RTF Tokens".
//
function RtfTkLen(t)
{
        return (t & 0xFF);
}

//_[RtfTkTxt()]_______________________________________________________________
//
// Returns the text of the ENTIRE token.  If only the control word is desired,
// from that token type, then use RtfTkCtl().
//
// t ...................... [ in] Token; see "RTF Tokens".
// s ...................... [ in] Source string.
// i ...................... [ in] Starting index where token was found.
//
function RtfTkTxt(t, s, i)
{
        return s.substr(i, t & 0xFF);
}

//_[RtfTkChr()]_______________________________________________________________
//
// Returns a string with a length of 1, for character tokens or symbols.
//
// t ...................... [ in] Token; see "RTF Tokens".
// s ...................... [ in] Source string.
// i ...................... [ in] Starting index where token was found.
//
function RtfTkChr(t, s, i)
{
        if (1792 !== (t & 0x700) && 1280 !== (t & 0x700))
                return null;

        return String.fromCharCode(((t >> 15) & 0xFFFF) - 32768);
}

//_[RtfTkCtl()]_______________________________________________________________
//
// Returns the control word portion of the token (e.g. without numeric value
// or preceding backslash).  Returns null if the token is not a control word.
//
// t ...................... [ in] Token; see "RTF Tokens".
// s ...................... [ in] Source string.
// i ...................... [ in] Starting index where token was found.
//
function RtfTkCtl(t, s, i)
{
        if (1536 !== (t & 0x700))
                return null;

        return s.substr(1 + i, 1 + ((t >> 11) & 0xF));
}

//_[RtfTkVal()]_______________________________________________________________
//
// Returns the numeric value of the token or NaN if it doesn't have one.
// Symbols return their character index.
//
// t ...................... [ in] Token; see "RTF Tokens".
//
function RtfTkVal(t)
{
        if (0 === (t >> 31))
                return NaN;

        return ((t >> 15) & 0xFFFF) - 32768;
}

//_[RtfSkipB()]_______________________________________________________________
//
// Skip a block ({ ... }) of RTF tokens.  Returns the position PAST the
// closing brace.
//
// s ...................... [ in] Source string.
// i ...................... [ in] Starting index.
// bc ..................... [ in] Brace Count; defaults to zero (0).
//
function RtfSkipB(s, i, bc)
{
        if (null == bc)
                bc = 0;

        var ps = i;
        var tl = 0;

        for (var ps = i; ps < s.length; ps += tl)
        {
                var tk = GetRtfTk(s, ps);
                var tl = tk & 0xFF;
                var ty = (tk >> 8) & 0x7;

                if (2 === ty)
                {
                        bc++;
                }
                else if (3 === ty)
                {
                        if (0 === bc)
                        {
                                ps += tl;
                                break;
                        }
                        else
                        {
                                bc--;
                        }
                }
        }

        return ps;

} // RtfSkipB()

//_[RtfConst()]_______________________________________________________________
//
// Returns an object of known RTF constants.
//
function RtfConst()
{
        if (null != RtfConst.dic)
                return RtfConst.dic;

        RtfConst.dic =
        {
                //
                // token types
                //
                INVALID                                         : 0,
                DATA                                            : 1,
                PUSH                                            : 2,
                POP                                                     : 3,
                IGNORABLE                                       : 4,
                SYMBOL                                          : 5,
                CONTROL                                         : 6,
                CHARACTER                                       : 7,

                //
                // \fcharset (Character set)
                //
                ANSI_CHARSET                            : 0,
                SYMBOL_CHARSET                          : 2,
                SHIFTJIS_CHARSET                        : 128,
                GREEK_CHARSET                           : 161,
                TURKISH_CHARSET                         : 162,
                HEBREW_CHARSET                          : 177,
                ARABICSIMPLIFIED_CHARSET        : 178,
                ARABICTRADITIONAL_CHARSET       : 179,
                ARABICUSER_CHARSET                      : 180,
                HEBREWUSER_CHARSET                      : 181,
                CYRILLIC_CHARSET                        : 204,
                EASTERNEUROPE_CHARSET           : 238,
                PC437_CHARSET                           : 254,
                OEM_CHARSET                                     : 255,
                
                //
                // \fprq (pitch)
                //
                PitchDefault                            : 0,
                PitchFixed                                      : 1,
                PitchVariable                           : 2
        };

        return RtfConst.dic;

} // RtfConst()

//_[RtfPkgOb()]_______________________________________________________________
//
// Parses an embedded object (\objdata) where the class is "Package"
// (\objclass); returns an object representing the package.  Currently this
// has the following members:
//
//      * label: The label for the entire package.
//      * size: The size of the package (not very useful once parsed).
//      * items[]: An array of files within the package.  Each item has the
//              properties 'name', 'path' (filename w/ path), and possibly 'data'
//              which is the file data as a string.
//
// IMPORTANT: This function is currently brittle on purpose, because I'm
// parsing based on tests done in reverse engineering attempts.  It's entirely
// possible that some of the assumptions here are wrong and I'd like to find
// those out.
//
// txt .................... [ in] RTF source string.
// beg .................... [ in] Beginning index of package data.
// end .................... [ in] Ending index of package data (one-past).
//
function RtfPkgOb(txt, beg, end)
{
        var pkg = { };
        var i = beg;
        var c = null;
        var n = null;

        // first 4 bytes should be: 01 05 00 00
        n = be4_();
        if (0x01050000 !== n)
                throw Error("Expected: 01 05 00 00; Instead: " + n.toString(16));

        // second 4 bytes should be: 02 00 00 00
        n = le4_();
        if (2 !== n)
                throw Error("Expected: 02 00 00 00 (2); Instead: " + n);

        // progid length
        pkg.progid = bstr_(true);
        trace("RtfPkgOb:ProgID = \"" + pkg.progid + "\"");

        if (0 != le4_() || 0 != le4_())
                throw Error("Expected two zero numbers!");

        pkg.totalsz = le4_();
        trace("RtfPkgOb:Total Size = " + pkg.totalsz);

        // should be at least 2 bytes, no more than 1 megabyte
        if (pkg.totalsz < 2 || pkg.totalsz > 1048576)
                throw Error("RtfPkgOb: Invalid Size " + pkg.totalsz);

        // Byte Counter
        var bc = 0;

        //
        // read string table
        //
        
        pkg.strings = new Array(le2_());
        bc += 2;
        dtrace("RtfPkgOb:Strings.length = " + pkg.strings.length);
        if (pkg.strings.length < 2 || pkg.strings.length > 10)
                throw Error("RtfPkgOb:Invalid Strings.length (" +
                        pkg.strings.length + ")");

        for (var si = 0; si < pkg.strings.length; si++)
        {
                pkg.strings[si] = str_();
                bc += pkg.strings[si].length;
                bc ++;
                trace("RtfPkgOb:Strings[" + si + "] = \"" + pkg.strings[si] + "\"");
        }
        pkg.label = pkg.strings[0];

        // string table ends with two zeros
        bc += 2;
        if (0 != le2_())
                throw Error("RtfPkgOb:Expected Double-Zero's After Strings");

        //
        // read OLE type (1 == linked, 3 == static)
        //
        pkg.oletype = le2_();
        bc += 2;
        trace("RtfPkgOb:OLE Type = " + pkg.oletype);
        if (1 !== pkg.oletype && 3 !== pkg.oletype)
                throw Error("RtfPkgOb: Unsupported OLE Type (" + pkg.oletype + ")");

        //
        // if static then read through the strings and their data
        // (bc == byte counter)
        //
        var trm = null;
        if (3 === pkg.oletype)
        {
                pkg.items = [ ];
                while (i < end)
                {
                        dtrace((pkg.items.length) + ". (" + bc + " / " +
                                pkg.totalsz + ")");

                        // read path
                        var item = { path : bstr_(true) };
                        bc += item.path.length;
                        bc += 5;
                        dtrace("Path=" + item.path);

                        // read data
                        item.data = bstr_(false);
                        bc += item.data.length;
                        bc += 4;

                        // add to list (name calculated later)
                        pkg.items.push(item);

                        // if at the end ... break for terminator check
                        if (bc == pkg.totalsz - 2)
                                break;

                } // while (read static OLE objects)
        }
        else if (1 === pkg.oletype)
        {
                pkg.items = new Array(le2_());
                bc += 2;
                dtrace("Items Length == " + pkg.items.length);

                for (var si = 0; si < pkg.items.length; si++)
                {
                        var item = { path : str_() };
                        trace("Item Path [" + si + "]: " + item.path);
                        bc += item.path.length;
                        bc ++;
                        
                        if (item.path.indexOf("~") >= 0)
                        {
                                trace("Reset Item Path to " + pkg.label);
                                item.path = pkg.label;
                        }
                        pkg.items[si] = item;
                }

                if (bc != pkg.totalsz - 2)
                        throw Error("RtfPkgOb: Wasted Data (" + (pkg.totalsz - 2 - bc) + ")");
        }

        // check terminator
        var trm = le2_();
        if (0 != trm)
                throw Error("RtfPkgOb: Invalid Terminator (" + trm + ")");

        //
        // create items' name property ...
        //
        for (var j = 0; j < pkg.items.length; j++)
        {
                var item = pkg.items[j];
                var si = item.path.lastIndexOf("\\");
                if (si > 0)
                        item.name = item.path.substr(si + 1);
                else
                        item.name = item.path;
        }

        return pkg;

        // - - - end of function / private methods follow - - -

        // read 4-byte big endian integer
        function be4_()
        {
                return (hx_() << 28) | (hx_() << 24) | (hx_() << 20) | (hx_() << 16) |
                        (hx_() << 12) | (hx_() <<  8) | (hx_() <<  4) | hx_();
        }

        // read 4-byte little endian integer
        function le4_()
        {
                return (hx_() << 4) | (hx_()) | (hx_() << 12) | (hx_() <<  8) |
                        (hx_() << 20) | (hx_() << 16) | (hx_() << 28) | (hx_() << 24);
        }

        // read 2-byte little endian integer
        function le2_()
        {
                return (hx_() << 4) | (hx_()) | (hx_() << 12) | (hx_() <<  8);
        }

        // read binary string that is preceded by a 4-byte length
        // (zt == zero terminated?)
        function bstr_(zt)
        {
                var len = le4_();
                dtrace("Len: " + len + " (" + i + ", " + end + ")");

                if (i + len > end)
                        throw Error("RtfPkgOb/bstr_: Out of Data");

                var a = [ ];
                var cnt = 0;
                var hs = [ ];

                while (i < end)
                {
                        var c = (hx_() << 4) | hx_();

                        a.push(c);
                        cnt++;
                        if (cnt >= len)
                                break;
                        if (a.length > 500)
                        {
                                hs.push(String.fromCharCode.apply(null, a));
                                a = [ ];
                        }
                }
                if (a.length > 0)
                {
                        hs.push(String.fromCharCode.apply(null, a));
                        a = [ ];
                }

                var s = hs.join("");
                if (true === zt)
                {
                        if (0 !== s.charCodeAt(s.length - 1))
                                throw Error("RtfPkgOb/bstr_: Unterminated String (" +
                                        s.charCodeAt(s.length - 1) + ")");
                        s = s.substr(0, s.length - 1);
                }

                return s;
        }

        // read string that is zero (null) terminated w/ no length prefix
        function str_()
        {
                var a = [ ];
                var hs = [ ];

                while (i < end)
                {
                        var c = (hx_() << 4) | hx_();
                        if (0 == c)
                                break;
                        a.push(c);
                        if (a.length > 500)
                        {
                                hs.push(String.fromCharCode.apply(null, a));
                                a = [ ];
                        }
                }
                if (a.length > 0)
                {
                        hs.push(String.fromCharCode.apply(null, a));
                        a = [ ];
                }

                return hs.join("");
        }

        // read hex character
        function hx_()
        {
                // read character, skipping white space
                do
                {
                        c = txt.charCodeAt(i++);
                } while (32 === c || 13 === c || 10 === c);

                if (c >= 0x30 && c <= 0x39)
                        return c - 0x30;
                if (c >= 0x41 && c <= 0x5A)
                        return c - 0x37;
                if (c >= 0x61 && c <= 0x7A)
                        return c - 0x57;
                if (i >= end)
                        throw Error("RtfPkgObj/hx_: Out of Data");

                throw Error("RtfPkgOb/hx_: Unexpected Code (" + c + "): '" +
                        txt.charAt(i-1) + "' @ " + i + " / " + end);
        }

} // RtfPkgOb()

//----------------------------------------------------------------------------
//----------------------------------------------------------------------------
// RtfParser Object
//
// Quick feature list:
// * Keeps track of stack
// * Skips ignore-able, unhandled destinations
// * Calls functions based on their mapping to destination names/paths
//
//----------------------------------------------------------------------------
//----------------------------------------------------------------------------

//_[RtfParser()]______________________________________________________________
//
// text ................... [ in] Rich text formatted string.
// strict ................. [ in] Enable strict format-checking handlers?
//                                                      (reserved; currently does nothing)
// nohandle ............... [ in] Do NOT enable basic destination handlers?
//
function RtfParser(text, strict, nohandle)
{
        var pt = RtfParser.prototype;
        if (true !== pt.__PtInit)
        {
                pt.Template             = RtfParser__Template;
                pt.HandleDest   = RtfParser__HandleDest;
                pt.Handlers             = RtfParser__Handlers;
                pt.Document             = RtfParser__Document;

                pt.HandlePcData = RtfParser__HandlePcData;
                pt.HandleIgnore = function(){};

                pt.__PtInit = true;
        }

        if (null == text)
                throw Error("RtfParser: Missing source RTF string");

        this.txt        = text; // source text
        this.pos        = 0;    // position in source text
        this.doc        = { };  // document object
        this.stk        = [ ];  // parsing stack
        this.frm        = { };  // current stack frame

        // destination handler collections
        //      dhd: dictionary where keys are either names or paths
        //      dhr: list of regular expressions, every other is handler reference
        this.dhd        = { };
        this.dhr        = [ ];

        // destination handler cache
        this.dhc        = { };
        this._chit      = 0; // cache hits
        this._cmis      = 0; // cache misses

        // enable basic handlers
        if (true !== nohandle)
        {
                this.HandleDest(";rtf", HandleMeta);
                this.HandleDest(";rtf;fonttbl", HandleFontTable);
                this.HandleDest(";rtf;fonttbl;f", HandleFontTable);
                this.HandleDest(";rtf;colortbl", HandleColorTable);
        }

        return; // constructor finished; methods follow - - -

        //_[RtfParser::Template()]________________________________________________
        //
        // Template destination handler function.
        //
        // t .................. [ in] Token.
        // s .................. [ in] Source string.
        // i .................. [ in] Index of token in source string.
        // o .................. [ in] Current stack frame.
        //
        function RtfParser__Template(t, s, i, o)
        {
                // do not return any value, this version ignores return values but a
                // future one might do something with them
        }

        //_[RtfParser::HandleDest()]______________________________________________
        //
        // Maps a destination to a handler function.  Destinations can be specif-
        // ied in three ways: a regular expression which will match against the
        // full path, a single name, or a full path.  Since control words are
        // always lower-case, case is not an issue.  Full paths are specified
        // using semi-colons, i.e. ";rtf;fonttbl".  Note there is no trailing
        // semi-colon.
        //
        // dest ............... [ in] Destination (String or RegExp).
        // handler ............ [ in] Handler function; see RtfParser::Template()
        //                                              for an example.
        //
        function RtfParser__HandleDest(dest, handler)
        {
                // clear cache
                this.dhc = { };
                this._chit = 0;
                this._cmis = 0;

                var i = null;

                if (RegExp === dest.constructor)
                {
                        // disallow duplicating the same regexp+handler
                        var sDest = dest.toString();
                        for (i = 0; i < this.dhr.length; i += 2)
                                if (this.dhr[i+1] === handler &&
                                        this.dhr[i].toString() === sDest)
                                        break;

                        if (i == this.dhr.length)
                        {
                                this.dhr.push(dest);
                                this.dhr.push(handler);
                        }
                }
                else if (String === dest.constructor)
                {
                        var list = this.dhd[dest];
                        if (null == list)
                        {
                                list = this.dhd[dest] = [ handler ];
                        }
                        else
                        {
                                for (i = 0; i < list.length; i++)
                                        if (list[i] === handler)
                                                break;

                                if (i == list.length)
                                {
                                        list.push(handler);
                                }
                        }
                }
                else
                {
                        throw Error("RtfParser::HandleDest: Invalid destination param");
                }

        } // RtfParser::HandleDest()

        //_[RtfParser::Handlers()]________________________________________________
        //
        // Returns the list of handlers for the specified destination.
        //
        function RtfParser__Handlers(tok, txt, pos, name, path)
        {
                // if a list has already been built for this exact stack path ...
                // (hasOwnProperty is used, because 'null' might be set)
                if (this.dhc.hasOwnProperty(path))
                {
                        this._chit++;
                        return this.dhc[path];
                }

                // missed cache, have to build up list from three sources
                this._cmis++;
                var dh = [ ];

                // source 1: by name (fonttbl)
                var a = this.dhd[name];
                if (null != a)
                        dh = dh.concat(a);

                // source 2: by path (;rtf;fonttbl)
                a = this.dhd[path];
                if (null != a)
                        dh = dh.concat(a);

                // source 3: regular expressions (/*tbl$/)
                var j = null;
                for (var i = 0; i < this.dhr.length; i += 2)
                {
                        var fnc = this.dhr[i+1];

                        // prevent duplicating function references
                        for (j = 0; j < dh.length; j++)
                                if (dh[j] === fnc)
                                        break;
                        if (j < dh.length)
                                continue;

                        var re = this.dhr[i];
                        if (re.test(path))
                                dh.push(fnc);
                }

                // never return a zero-length array; use null to indicate no handlers
                if (0 === dh.length)
                        return (this.dhc[path] = null);

                return (this.dhc[path] = dh);

        } // RtfParser::Handlers()

        //_[RtfParser::Document()]________________________________________________
        //
        // Returns the parsed document; that is, if it hasn't already been parsed
        // then this blocks until it IS parsed.
        //
        // incomplete ......... [ in] Allow returning of incomplete document?  By
        //                                              default this function will block until parsing is
        //                                              complete.
        //
        function RtfParser__Document(incomplete)
        {
                // return immediately if 'incomplete' is set OR parsing is complete
                if (true === incomplete || this.pos === this.txt.length)
                        return this.doc;

                //
                // main loop
                //
                var tok, len, typ;
                for ( ; this.pos < this.txt.length; this.pos += len)
                {
                        tok = GetRtfTk(this.txt, this.pos);
                        len = tok & 0xFF;
                        typ = (tok >> 8) & 0x7;

                        // - -
                        // open brace, push new destination
                        //
                        if (2 === typ)
                        {
                                var btk = tok;
                                var bps = this.pos;

                                // read token immediately following open brace
                                this.pos += len;
                                tok = GetRtfTk(this.txt, this.pos);
                                len = tok & 0xFF;
                                typ = (tok >> 8) & 0x7;

                                // ignorable destination marker
                                var ign = false;
                                if (4 === typ)
                                {
                                        ign = true;

                                        // read token PAST marker
                                        this.pos += len;
                                        tok = GetRtfTk(this.txt, this.pos);
                                        len = tok & 0xFF;
                                        typ = (tok >> 8) & 0x7;
                                }

                                // token MUST be control word
                                if (6 !== typ)
                                        throw Error("RtfParser: No control after open brace!");

                                // create new stack frame with stuff we know about (handlers
                                // should be careful about using ANY three-character var name)
                                var nfr =
                                {
                                        tok : tok,
                                        pos : this.pos,
                                        ctl : RtfTkCtl(tok, this.txt, this.pos),
                                        doc : this.doc,
                                        stk : this.stk
                                };
                                
                                // determine stack path, e.g. the names of all destinations
                                // joined into one string and separated by semi-colons
                                if (0 === this.stk.length)
                                        nfr.pth = ";" + nfr.ctl;
                                else
                                        nfr.pth = this.stk[this.stk.length-1].pth + ";" + nfr.ctl;

                                // get list of handlers for this destination
                                nfr._dh = this.Handlers(tok, this.txt, this.pos, nfr.ctl, nfr.pth);

                                // if no handlers found ...
                                if (null == nfr._dh)
                                {
                                        // unrecognized, non-ignorable destination
                                        if (true !== ign)
                                                throw Error("RtfParser: Unhandled Destination \"" +
                                                        nfr.ctl + "\" (" + nfr.pth + ")");

                                        // ignore destination by skipping its block
                                        this.pos = RtfSkipB(this.txt, this.pos);

                                        // clear length so iteration doesn't increment 'this.pos'
                                        len = 0;
                                }
                                // else (handler(s) found) ...
                                else
                                {
                                        // push our new frame
                                        this.frm = nfr;
                                        this.stk.push(nfr);

                                        // call each handler to let them know they're being pushed
                                        for (var i = 0; i < nfr._dh.length; i++)
                                                nfr._dh[i](btk, this.txt, bps, nfr);
                                }
                        }
                        // - -
                        // close brace, pop current destination
                        //
                        else if (3 === typ)
                        {
                                // this check also prevents a null 'this.frm' from beind used
                                if (0 === this.stk.length)
                                        throw Error("RtfParser: Too many closing braces!");

                                // call current destination handlers to let them know they're
                                // about to be popped
                                for (var i = 0; i < this.frm._dh.length; i++)
                                        this.frm._dh[i](tok, this.txt, this.pos, this.frm);

                                this.stk.pop();
                                if (0 === this.stk.length)
                                        this.frm = null;
                                else
                                        this.frm = this.stk[this.stk.length - 1];
                        }
                        // - -
                        // invalid, text, symbol, control, or character
                        //
                        // pass these types to current destination handler(s)
                        //
                        else
                        {
                                // call current destination handlers with this token
                                if (null != this.frm)
                                {
                                        for (var i = 0; i < this.frm._dh.length; i++)
                                                this.frm._dh[i](tok, this.txt, this.pos, this.frm);
                                }
                                else
                                {
                                        // ignored, unprocessed token ... this only happens when
                                        // there are tokens at the "global" level (e.g. before
                                        // {\rtf and after final }).  Usually this is for white-
                                        // space, but I don't think we really care.
                                }
                        }

                } // for (main loop)
        
                return this.doc;

        } // RtfParser::Document()

        //------------------------------------------------------------------------
        //------------------------------------------------------------------------
        // Generic Handlers
        //
        // * HandlePcData()
        //
        //------------------------------------------------------------------------
        //------------------------------------------------------------------------

        //_[RtfParser::HandlePcData()]____________________________________________
        //
        // Used for destinations which are simply a #PCDATA text string.  A
        // property of the same name is created on the previous stack frame.
        //
        function RtfParser__HandlePcData(t, s, i, o)
        {
                if (513 === t)
                {
                        o.dat = [ ];
                        return;
                }
                else if (769 === t)
                {
                        // previous stack frame
                        var pfrm = o.stk[o.stk.length-2];
                        pfrm[o.ctl] = o.dat.join("");
                        dtrace("#PCDATA " + o.ctl + "=\"" + pfrm[o.ctl] + "\"");
                        return;
                }

                var typ = RtfTkTyp(t);
                if (1 !== typ)
                        throw Error("RtfParser: Unexpected type (" + typ + ") in \"" +
                                o.ctl + "\" #PCDATA");

                o.dat.push(RtfTkTxt(t, s, i));

        } // RtfParser::HandlePcData()

        //------------------------------------------------------------------------
        //------------------------------------------------------------------------
        // Basic Handlers
        //
        // * HandleMeta()
        // * HandleFontTable()
        // * HandleColorTable()
        //
        //------------------------------------------------------------------------
        //------------------------------------------------------------------------

        //_[HandleMeta()]_________________________________________________________
        //
        // Gets RTF meta data.
        //
        function HandleMeta(t, s, i, o)
        {
                if (513 === t)
                {
                        o.doc.ver = RtfTkVal(o.tok);
                        return;
                }

                var ctl = RtfTkCtl(t, s, i);
                switch (ctl)
                {
                        // ansi/mac/pc/pca: Character Set
                        case "ansi":
                        case "mac":
                        case "pc":
                        case "pca":
                                o.doc.charset = ctl;
                                break;

                        // ansicpg: ANSI Code Page
                        case "ansicpg":
                                o.doc.codepage = RtfTkVal(t);
                                break;

                        // deff: Default Font (index into fonts[])
                        case "deff":
                                o.doc.deff = RtfTkVal(t);
                                break;
                }

        } // HandleMeta()

        //_[HandleFontTable()]____________________________________________________
        //
        // Interprets RTF font table into a 'fonts' list on the document object.
        // Each font object generally has at least a "name" member.
        //
        function HandleFontTable(t, s, i, o)
        {
                var val = null, ctl = null;
                if (513 === t)
                {
                        if (null == o.doc.fonts)
                                o.doc.fonts = [ ];

                        ctl = RtfTkCtl(o.tok, s, o.pos);
                        val = RtfTkVal(o.tok);
                }
                else
                {
                        ctl = RtfTkCtl(t, s, i);
                        val = RtfTkVal(t);
                }

                var typ = (t >> 8) & 0x7;
                if (1 === typ)
                {
                        var txt = RtfTkTxt(t, s, i);
                        o.font.name = txt;
                        if (";" == o.font.name.charAt(o.font.name.length-1))
                                o.font.name = o.font.name.substr(0, o.font.name.length-1);
                        return;
                }

                switch (ctl)
                {
                        // f: New Font
                        case "f":
                                o.font = o.doc.fonts[val] = new Object;
                                break;

                        case "fnil":
                        case "froman":
                        case "fswiss":
                        case "fmodern":
                        case "fscript":
                        case "fdecor":
                        case "ftech":
                        case "fbidi":
                                o.font.family = ctl.substr(1);
                                break;

                        case "fcharset":
                                o.font.charset = val;
                                break;

                        case "fprq":
                                o.font.pitch = val;
                                break;

                        case "ftnil":
                        case "fttruetype":
                                o.font.type = ctl.substr(2);
                                break;

                        case "cpg":
                                o.font.codepage = val;
                                break;
                }

        } // HandleFontTable()

        //_[HandleColorTable()]___________________________________________________
        //
        // Interprets RTF color table into a 'colors' list on the document object.
        // Each color object has the members 'r', 'g', and 'b'.
        //
        function HandleColorTable(t, s, i, o)
        {
                if (513 === t)
                {
                        if (null == o.doc.colors)
                        {
                                o.color = { r : 0, g : 0, b : 0 };
                                o.doc.colors = [ o.color ];
                        }
                                
                        return;
                }
                else if (769 === t)
                {
                        // closing
                        return;
                }

                var typ = (t >> 8) & 0x7;
                if (1 === typ)
                {
                        var txt = RtfTkTxt(t, s, i);
                        if (";" == txt)
                        {
                                o.color = { r : 0, g : 0, b : 0 };
                                o.doc.colors.push(o.color);
                        }
                        return;
                }
                else if (6 !== typ)
                {
                        return;
                }

                var ctl = RtfTkCtl(t, s, i);
                var val = RtfTkVal(t);
                if ("red" == ctl)
                {
                        o.color.r = val;
                }
                else if ("green" == ctl)
                {
                        o.color.g = val;
                }
                else if ("blue" == ctl)
                {
                        o.color.b = val;
                }
                else
                {
                        throw Error("Unrecognized token in color table: " +
                                RtfTkTxt(t, s, i));
                }

        } // HandleColorTable()

} // RtfParser()
//*[rtf2html.js]*************************[http://code.google.com/p/obremsdk/]*
//
// JavaScript: RTF to HTML Conversion
// Version 0.12
//
// Utilizes RtfParser found in rtf.js module.
//
//-[History]------------------------------------------------------------------
// 2007-09-24 by NeilO .... v0.12: Made part of ObremSDK.
// 2007-03-04 by NeilO .... Created.
//
// (C)opyright 2007++ by Neil C. Obremski;                     New BSD License
//***********************[http://www.opensource.org/licenses/bsd-license.php]*

//_[Rtf2Html()]_______________________________________________________________
//
// Highest-level conversion function and easiest to use.  Just call and you'll
// be returned a string of HTML text.
//
// txt .................... [ in] Rich text formatted (RTF) string.
// baseurl ................ [ in] Base URL for hyperlinks.
// out .................... [ in] Output object; will contain files to be
//                                                      written out.
// ver .................... [ in] Version.  Currently only 2 is supported.
//

// CUSTOMIZATION HERE. THE FOLLOWING FUNCTION WAS ORIGINALLY DECLARED AS:
// function Rtf2Html(txt, baseurl, out, ver)
module.exports = function(txt, baseurl, out, ver)
{
        var parser = new RtfParser(txt);

        if (null == ver)
                ver = 2;
        if (2 != ver)
                throw Error("HTML version " + ver + " not supported");

        parser.HandleDest(";rtf", Main_);
        parser.HandleDest("pn", Bullets_);
        parser.HandleDest("pntxtb", parser.HandleIgnore);
        parser.HandleDest("pntext", parser.HandleIgnore);
        parser.HandleDest(";rtf;object", Pkg_);
        parser.HandleDest(";rtf;listtext", ListText_);
        parser.HandleDest(";rtf;object;objclass", parser.HandlePcData);
        parser.HandleDest(";rtf;object;objdata", PkgData_);
        parser.HandleDest(";rtf;object;result", parser.HandleIgnore);
        parser.HandleDest(";rtf;rtlch", Main_);
        parser.HandleDest(";rtf;fonttbl;fbiminor", parser.HandleIgnore);
        parser.HandleDest(";rtf;fonttbl;fhiminor", parser.HandleIgnore);
        parser.HandleDest(";rtf;fonttbl;fdbminor", parser.HandleIgnore);
        parser.HandleDest(";rtf;fonttbl;flominor", parser.HandleIgnore);
        parser.HandleDest(";rtf;fonttbl;fbimajor", parser.HandleIgnore);
        parser.HandleDest(";rtf;fonttbl;fhimajor", parser.HandleIgnore);
        parser.HandleDest(";rtf;fonttbl;fdbmajor", parser.HandleIgnore);
        parser.HandleDest(";rtf;fonttbl;flomajor", parser.HandleIgnore);
        parser.HandleDest(";rtf;mmath", parser.HandleIgnore);
        parser.HandleDest(";rtf;info;vern", parser.HandleIgnore);
        parser.HandleDest(";rtf;info;author", parser.HandleIgnore);
        parser.HandleDest(";rtf;info;nofpages", parser.HandleIgnore);
        parser.HandleDest(";rtf;info;nofwords", parser.HandleIgnore);
        parser.HandleDest(";rtf;info;nofcharsws", parser.HandleIgnore);
        parser.HandleDest(";rtf;info;nofchars", parser.HandleIgnore);
        parser.HandleDest(";rtf;info;edmins", parser.HandleIgnore);
        parser.HandleDest(";rtf;info;version", parser.HandleIgnore);
        parser.HandleDest(";rtf;info;revtim", parser.HandleIgnore);
        parser.HandleDest(";rtf;info;creatim", parser.HandleIgnore);
        parser.HandleDest(";rtf;info;operator", parser.HandleIgnore);
        parser.HandleDest(";rtf;info", parser.HandleIgnore);
        parser.HandleDest(";rtf;stylesheet", parser.HandleIgnore);
        parser.HandleDest(";rtf;stylesheet;s", parser.HandleIgnore);
        parser.HandleDest(";rtf;stylesheet;ql", parser.HandleIgnore);
        parser.HandleDest(";rtf;object;result;pict", parser.HandleIgnore);

        parser.Document(true).baseurl = baseurl;
        parser.Document(true).outo = out;

        return parser.Document().html;

        //-[Main_()]--------------------------------------------------------------
        //
        function Main_(t, s, i, o)
        {
                if (513 === t)
                {
                        o.newpara = true;
                        // create string-builder for HTML in this destination
                        o.html = o.doc.sbhtml = [ ];
                }
                else if (769 === t)
                {
                        EndPara_();

                        // build string and set it on main document
                        o.doc.html = o.doc.html || "";
                        o.doc.html += o.html.join("");
                }

                var typ = RtfTkTyp(t);

                if (1 === typ)
                {
                        if (null != o.par_beg)
                        {
                                o.html.push(o.par_beg);
                                o.par_beg = null;
                        }
        
                        if (true == o.newpara)
                        {
                                o.lastpari = o.html.length;
                                o.newpara = false;
                                Img_("LEFT");
                        }
                        else
                        {
                                Img_();
                        }

                        o.html.push(esc_(RtfTkTxt(t, s, i)));
                        return;
                }
                else if (5 === typ)
                {
                        o.html.push(esc_(RtfTkChr(t, s, i)));
                        return;
                }

                var ctl = RtfTkCtl(t, s, i);
                var val = RtfTkVal(t);

                switch (ctl)
                {
                        case "pard":
                                EndPara_();
                                break;

                        case "tab":
                                o.html.push("&nbsp;&nbsp;&nbsp;&nbsp;");
                                break;

                        case "li":
                                /* Comment out as indented text isn't necessarily a blockquote.
                                if (o.bullets)
                                {
                                        // ignore when bullets are on
                                }
                                else if (0 != val)
                                {
                                        if (!o.indented)
                                        {
                                                o.html.push("<BLOCKQUOTE>");
                                                o.indented = true;
                                        }
                                }
                                else if (o.indented)
                                {
                                }
                                */
                                break;

                        case "f":
                                /* Commented out as we have no need for font definitions
                                o.font = o.doc.fonts[val];
                                
                                //WScript.Echo("Selected Font " + val);
                                //WScript.Echo("Font Name: " + o.font.name + " (" + o.font.family + ")");
                                
                                if (o.font.name.match(/(courier|system|fixed)/i))
                                {
                                        if (!o.monofont)
                                        {
                                                o.monofont = true;
                                                o.html.push("<CODE>");
                                        }
                                }
                                else if (o.monofont)
                                {
                                        o.html.push("</CODE>");
                                        o.monofont = false;
                                }

                                */
                                break;

                        // font size
                        case "fs":

                                if (o.chgsz < 0)
                                {
                                        for ( ; o.chgsz < 0; o.chgsz++)
                                                o.html.push("</SMALL>");
                                }
                                else if (o.chgsz > 0)
                                {
                                        for ( ; o.chgsz > 0; o.chgsz--)
                                                o.html.push("</BIG>");
                                }                               

                                switch (val >> 1)
                                {
                                        case 12:
                                                o.chgsz = 1;
                                                o.html.push("<BIG>");
                                                break;
                                        case 10:
                                                break;
                                        case 8:
                                                o.chgsz = -1;
                                                o.html.push("<SMALL>");
                                                break;
                                }
                                break;
                        
                        case "line":
                                if (o.bullets)
                                {
                                        if (!o.bulletline)
                                                o.bulletline = true;
                                }

                                o.html.push("<BR>");
                                break;

                        case "par":
                                Img_("RIGHT");
                                o.newpara = true;
                                if (o.bullets)
                                {
                                        if (o.bulletline)
                                        {
                                                o.html.push("<BR>");
                                                o.bulletline = false;
                                        }
                                        o.html.push("</LI>");
                                        o.par_beg = "<LI>";
                                }
                                else if (null == o.par_end)
                                {
                                        o.html.push("<BR>");
                                }
                                else
                                {
                                        o.html.push(o.par_end);
                                        o.par_end = null;
                                }
                                break;
                        
                        case "qc":
                                o.center = true;
                                if (0 === val)
                                {
                                        o.center = false;
                                        o.html.push("</CENTER>");
                                }
                                else
                                {
                                        o.html.push("<CENTER>");
                                }
                                break;

                        case "b":
                                if (0 === val)
                                        o.html.push("</B>");
                                else
                                        o.html.push("<B>");
                                break;
                        case "i":
                                if (0 === val)
                                        o.html.push("</I>");
                                else
                                        o.html.push("<I>");
                                break;
                        case "strike":
                                if (0 === val)
                                        o.html.push("</S>");
                                else
                                        o.html.push("<S>");
                                break;
                        case "ul":
                        case "u":
                                if (0 === val)
                                        o.html.push("</U>");
                                else
                                        o.html.push("<U>");
                                break;
                }

                // end of main (private helpers follow)

                function Img_(align)
                {
                        if (null != o.doc.limg)
                        {
                                var imgtag = "<IMG SRC=\"" + o.doc.baseurl + o.doc.limg.name +
                                        "\" HSPACE=\"5\" VSPACE=\"5\" " +
                                        (null == align ? "" : "ALIGN=\"" + align + "\"") + " />";

                                if ("RIGHT" == align && null != o.lastpari)
                                {
                                        o.html.splice(o.lastpari, 0, imgtag);
                                }
                                else
                                {
                                        o.html.push(imgtag);
                                }

                                o.doc.limg = null;
                        }
                }

                function EndPara_()
                {
                        Img_();
                        if (o.center)
                        {
                                o.html.push("</CENTER>");
                                o.center = false;
                        }
                        o.newpara = true;
                        o.bulletline = false;
                        o.par_beg = null;
                        if (o.chgsz < 0)
                        {
                                for ( ; o.chgsz < 0; o.chgsz++)
                                        o.html.push("</SMALL>");
                        }
                        else if (o.chgsz > 0)
                        {
                                for ( ; o.chgsz > 0; o.chgsz--)
                                        o.html.push("</BIG>");
                        }
                        if (o.monofont)
                        {
                                o.html.push("</CODE>");
                                o.monofont = false;
                        }
                        if (o.indented)
                        {
                                o.html.push("</BLOCKQUOTE>");
                                o.par_end = "";
                                o.indented = false;
                        }
                        if (o.bullets)
                        {
                                o.html.push("</UL>");
                                o.par_end = "";
                                o.bullets = false;
                        }
                }

                function esc_(s)
                {
                        return s.replace(/&/g, '&amp;')         // ampersands
                                        .replace(/</g, '&lt;')          // open bracket
                                        .replace(/>/g, '&gt;')          // close bracket
                                        .replace(/\"/g, '&quot;')       // quote
                                        .replace(/  /g, " &nbsp;")
                                        ;
                }
        }

        //-[Bullets_()]-----------------------------------------------------------
        function Bullets_(t, s, i, o)
        {
                if (513 === t)
                {
                        o.stk[o.stk.length-2].bullets = true;
                        o.stk[o.stk.length-2].html.push("<UL><LI>");
                }
        }

        //-[Bullets_()]-----------------------------------------------------------
        function ListText_(t, s, i, o)
        {
                if (513 === t)
                {
                        var bullets = o.stk[o.stk.length-2].bullets;
                        o.stk[o.stk.length-2].bullets = true;
                        if (!bullets) {
                                o.stk[o.stk.length-2].html.push("<UL><LI>");
                        } else {
                                o.stk[o.stk.length-2].html.push("</LI><LI>");
                        }
                }
        }

        //-[Pkg_()]---------------------------------------------------------------
        //
        function Pkg_(t, s, i, o)
        {
                if (513 === t)
                {
                        return;
                }
                else if (769 === t)
                {
                        return;
                }

                var ctl = RtfTkCtl(t, s, i);
                var val = RtfTkVal(t);

                switch (ctl)
                {
                        case null:
                                break;
                        case "objemb":
                                break;
                        case "objclass":
                                break;
                        case "objw":
                                break;
                        case "objh":
                                break;
                        default:
                                WScript.Echo("Unhandled CTL: " + ctl);
                }
        }

        //-[PkgData_()]-----------------------------------------------------------
        //
        function PkgData_(t, s, i, o)
        {
                if (769 === t)
                {
                        var pfrm = o.stk[o.stk.length - 2];

                        // output a package
                        if ("Package" == pfrm.objclass)
                        {
                                var start = o.pos + RtfTkLen(o.tok);
                                var end = i;
                                var pkg = RtfPkgOb(s, start, end);
                                for (var j = 0; j < pkg.items.length; j++)
                                {
                                        var item = pkg.items[j];
                                        if (null != o.doc.outo)
                                        {
                                                if (null == o.doc.outo.files)
                                                        o.doc.outo.files = [ item ];
                                                else
                                                        o.doc.outo.files.push(item);
                                        }

                                        if (item.name.match(/\.(gif|png|jpe?g)$/i))
                                        {
                                                o.doc.limg = item;
                                        }
                                        else
                                        {
                                                o.doc.sbhtml.push("{<A HREF=\"" + o.doc.baseurl +
                                                        pkg.items[j].name + "\">" + pkg.items[j].name + "</A>}");
                                        }
                                }
                        }
                }
        }


} // Rtf2Html
