<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8" />
	<meta http-equiv="X-UA-Compatible" content="IE=Edge;chrome=1" >
	<meta name="keywords" content="Mona, Jewelery" >
	<meta name="description" content="" >
	<title>That's Mona</title>
	<!--[if IE]>
		<script src="http://html5shiv.googlecode.com/svn/trunk/html5.js"></script>
	<![endif]-->
	<link rel="shortcut icon" type="image/x-icon" href="img/favicon.ico" />
	<link media="screen" type="text/css" href="css/layout.css" rel="stylesheet"/>
</head>
<body>
	<div class="wrapper">
					<div id="social">
					<ul>
					<li><a href="http://www.facebook.com/ohthatsmona" target="_blank"><img src="img/facebook.png" alt="Facebook" /></a></li>
					<li><a href="https://twitter.com/#!/thats_mona" target="_blank"><img src="img/twitter.png" alt="Twitter" /></a></li>
					</ul>
				</div>
		<header id="masthead">
			<nav>
				<ul>
					<li><a href="about.html"><img src="img/nav/about.png" alt="About" /></a></li>
					<li><a href="gallery.html"><img src="img/nav/gallery.png" alt="Gallery" /></a></li>
					<li><a href="http://shop.thatsmona.com/" target="_blank"><img src="img/nav/shop.png" alt="Shop" /></a></li>
					<li class="home"><a href="index.html"><img src="img/nav/home.png" alt="That's Mona" /></a></li>
					<li><a href="press.html"><img src="img/nav/press.png" alt="Press" /></a></li>
					<li><a href="http://thatsmona.tumblr.com/" target="_blank"><img src="img/nav/blog.png" alt="Blog" /></a></li>
					<li><a href="contact.html"><img src="img/nav/contact.png" alt="Contact" /></a></li>
				</ul>
			</nav>
		</header>
		<section id="main">
			<div id="media_wrap" class="home_content"><a href="#"><img src="img/video.png" /></a></div>
		</section>
	</div>
	<script type="text/javascript" src="js/mustache.js"></script>
	<script type="text/javascript" src="js/jquery.js"></script>
	<script type="text/javascript">
	$(function() {  
		$('#media_wrap').click(function(){
			var data = { video : 'wXfhQRnN2XA' }
			var template = '<object width= "700" height="460"><param name="movie" value="http://www.youtube.com/v/{{video}}&ap=%2526fmt%3D18&autoplay=1&rel=0&fs=1&border=0&loop=0"></param><param name="allowFullScreen" value="true"></param><embed src="http://www.youtube.com/v/{{video}}&ap=%2526fmt%3D18&autoplay=1&rel=0&fs=1&border=0&loop=0" type="application/x-shockwave-flash" allowfullscreen="true" width="700" height="460"></embed></object>';
			var html = Mustache.to_html(template, data);
			
			$(this).html(html);
			return false;
		});
	});
	</script>
	
	<script type="text/javascript">

  var _gaq = _gaq || [];
  _gaq.push(['_setAccount', 'UA-29135912-1']);
  _gaq.push(['_trackPageview']);

  (function() {
    var ga = document.createElement('script'); ga.type = 'text/javascript'; ga.async = true;
    ga.src = ('https:' == document.location.protocol ? 'https://ssl' : 'http://www') + '.google-analytics.com/ga.js';
    var s = document.getElementsByTagName('script')[0]; s.parentNode.insertBefore(ga, s);
  })();

</script>
</body>
</html>