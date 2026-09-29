#!/bin/bash
# review pack: name "query" pairs
node tools/shot.js \
 P1_glassy_dawn "sea=0.6&hour=6.0&clouds=0.3&cam=0,2.2,0,100,3&warm=6&yacht=0" \
 P2_noon_F4_yacht "sea=4&hour=13&clouds=0.4&cam=-70,3.5,30,55,3&warm=25&at=yacht&rel=-42,4,-30&aty=6&ys=120" \
 P3_sunset_glitter "sea=3&hour=18.05&clouds=0.4&cam=0,2.5,0,0,0&look=sun&lp=-3&ly=4&warm=20&yacht=0" \
 P4_F7_whitecaps "sea=7&hour=14&clouds=0.6&cam=0,7,0,220,-6&warm=25&yacht=0" \
 P5_storm_F9 "sea=9.5&hour=16&clouds=1&rain=0.9&lightning=1&cam=0,9,0,250,3&warm=25&yacht=0&strike=-8&sage=0.1" \
 P6_moonlit "sea=2&hour=21.6&clouds=0.2&cam=0,3,0,0,0&look=moon&lp=-7&warm=15&yacht=0" \
 P7_under "sea=3&hour=12&clouds=0.35&cam=0,-8,-14,0,8&warm=8&yacht=0" \
 P8_yacht_close "sea=3.5&hour=16.3&clouds=0.4&cam=0,3,0,0,0&at=yacht&rel=-22,2.2,-16&aty=4.5&warm=20&ys=150" \
 P9_aerial "sea=5&hour=11&clouds=0.5&cam=0,260,0,200,-25&warm=30&yacht=0"
